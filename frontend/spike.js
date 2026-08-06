const API = '/api';
const WS_URL = `ws://${location.hostname}:8000/ws/updates`;

// ── Seat layout: rows A-F, 6 cols (3+3) ──────────────────────────────────────
const ROWS = ['A', 'B', 'C', 'D', 'E', 'F'];
const COLS = [1, 2, 3, 4, 5, 6];
const ALL_SEATS = ROWS.flatMap(r => COLS.map(c => `${r}${c}`));

const state = {
  logs: [],
  seats: Object.fromEntries(ALL_SEATS.map(s => [s, 'available'])),
  mySeats: new Set(),
  selectedSeat: 'A1',
  token: localStorage.getItem('spike_token') || '',
  email: localStorage.getItem('spike_email') || `user-${Math.random().toString(36).slice(2, 7)}@demo.com`,
  eventId: null,
  busy: false,
  spikeRunning: false,
  stats: { queued: 0, confirmed: 0, failed: 0, total: 0 },
  wsStatus: 'disconnected',
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function esc(v) {
  return String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

async function api(path, opts = {}) {
  const r = await fetch(`${API}${path}`, opts);
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
}

function log(msg, tone = 'info') {
  const ts = new Date().toLocaleTimeString('en-GB', { hour12: false });
  state.logs.unshift({ ts, msg, tone });
  if (state.logs.length > 120) state.logs.length = 120;
  renderLogs();
  renderStats();
}

// ── Countdown to next 10:00:00 AM ─────────────────────────────────────────────
function msToNextTen() {
  const now = new Date();
  const target = new Date(now);
  target.setHours(10, 0, 0, 0);
  if (target <= now) target.setDate(target.getDate() + 1);
  return target - now;
}

function formatCountdown(ms) {
  if (ms <= 0) return '00:00:00';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return [h, m, sec].map(n => String(n).padStart(2, '0')).join(':');
}

let spikeAutoFired = false;

function tickCountdown() {
  const ms = msToNextTen();
  const el = document.getElementById('countdown-time');
  if (!el) return;
  el.textContent = formatCountdown(ms);
  if (ms < 1000 && !spikeAutoFired) {
    spikeAutoFired = true;
    el.classList.add('firing');
    log('🚀 10:00:00 AM — spike auto-fired!', 'spike');
    launchSpike();
  }
}

// ── Seat map rendering ────────────────────────────────────────────────────────
function renderSeatMap() {
  const grid = document.getElementById('seat-grid');
  if (!grid) return;
  grid.innerHTML = ROWS.map(row => {
    const cells = COLS.map(col => {
      const id = `${row}${col}`;
      const status = state.seats[id] || 'available';
      const cls = state.mySeats.has(id) ? 'mine' : status;
      const sel = id === state.selectedSeat && cls === 'available' ? ' selected' : '';
      return `<div class="seat ${cls}${sel}" data-seat="${esc(id)}" title="${esc(id)}">${esc(id)}</div>`;
    });
    // insert aisle between col 3 and 4
    cells.splice(3, 0, '<div class="aisle"></div>');
    return `<div class="seat-row"><div class="row-label">${esc(row)}</div>${cells.join('')}</div>`;
  }).join('');

  grid.querySelectorAll('.seat.available, .seat.selected').forEach(el => {
    el.onclick = () => {
      state.selectedSeat = el.dataset.seat;
      const inp = document.getElementById('seat-input');
      if (inp) inp.value = state.selectedSeat;
      renderSeatMap();
    };
  });
}

// ── Log rendering ─────────────────────────────────────────────────────────────
function renderLogs() {
  const el = document.getElementById('log-scroll');
  if (!el) return;
  el.innerHTML = state.logs.map(e =>
    `<div class="log-entry ${esc(e.tone)}"><span class="ts">${esc(e.ts)}</span><span>${esc(e.msg)}</span></div>`
  ).join('');
  // badge
  const badge = document.getElementById('log-badge');
  if (badge) badge.textContent = `${state.logs.length} entries`;
}

function renderStats() {
  const map = { 'stat-queued': state.stats.queued, 'stat-confirmed': state.stats.confirmed, 'stat-failed': state.stats.failed, 'stat-total': state.stats.total };
  for (const [id, val] of Object.entries(map)) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }
}

// ── WebSocket ─────────────────────────────────────────────────────────────────
function connectWS() {
  let ws;
  try { ws = new WebSocket(WS_URL); } catch { return; }

  ws.onopen = () => {
    state.wsStatus = 'connected';
    updateWsBadge();
    log('WebSocket connected to live stream', 'good');
  };

  ws.onmessage = ({ data }) => {
    let ev;
    try { ev = JSON.parse(data); } catch { return; }

    switch (ev.type) {
      case 'spike_reset':
        log(`🔄 Seats reset for event #${ev.event_id} — ready for spike`, 'spike');
        for (const s of Object.keys(state.seats)) state.seats[s] = 'available';
        renderSeatMap();
        break;
      case 'spike_start':
        state.stats.total = ev.users;
        log(`⚡ Spike started — ${ev.users} users racing for ${ev.seats} seats`, 'spike');
        break;
      case 'user_queued':
        state.stats.queued++;
        log(`→ ${ev.user} queued for seat ${ev.seat} (pos ${ev.position})`, 'info');
        break;
      case 'seat_attempt':
        log(`⏳ ${ev.user} attempting seat ${ev.seat} [${ev.status}]`, 'info');
        break;
      case 'booking_confirmed': {
        state.stats.confirmed++;
        const seats = ev.seats || [];
        seats.forEach(s => {
          if (state.mySeats.has(s)) {
            log(`✅ YOUR seat ${s} confirmed! Ref: ${ev.booking_ref}`, 'good');
            showResult(true, `Booking confirmed! Ref: ${ev.booking_ref} — Seat ${s}`);
          } else {
            log(`✅ Seat ${s} booked by user #${ev.user_id} — ref ${ev.booking_ref}`, 'good');
          }
          state.seats[s] = 'booked';
          flashSeat(s);
        });
        renderSeatMap();
        break;
      }
      case 'booking_failed': {
        state.stats.failed++;
        const seats = ev.seats || [];
        seats.forEach(s => log(`❌ Seat ${s} booking failed (user #${ev.user_id})`, 'bad'));
        break;
      }
      case 'spike_done':
        state.spikeRunning = false;
        log(`🏁 Spike complete — ${ev.total} users processed`, 'spike');
        updateSpikeBtn();
        break;
      case 'spike_error':
        log(`⚠ Error for ${ev.user}: ${ev.error}`, 'warn');
        break;
    }
    renderStats();
  };

  ws.onclose = () => {
    state.wsStatus = 'disconnected';
    updateWsBadge();
    setTimeout(connectWS, 3000);
  };
  ws.onerror = () => { state.wsStatus = 'error'; updateWsBadge(); };
}

function updateWsBadge() {
  const el = document.getElementById('ws-badge');
  if (el) { el.textContent = state.wsStatus; el.className = `log-badge ${state.wsStatus === 'connected' ? 'good' : ''}`; }
}

function flashSeat(id) {
  const el = document.querySelector(`[data-seat="${id}"]`);
  if (el) el.classList.add('just-booked');
}

// ── Auth + booking ────────────────────────────────────────────────────────────
async function ensureAuth() {
  if (state.token) return true;
  const email = state.email;
  try {
    await api('/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'spike123!', role: 'user' }),
    });
  } catch { /* already exists */ }
  try {
    const r = await api('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'spike123!' }),
    });
    state.token = r.access_token;
    localStorage.setItem('spike_token', state.token);
    localStorage.setItem('spike_email', email);
    log(`Authenticated as ${email}`, 'good');
    return true;
  } catch (e) {
    log(`Auth failed: ${e.message}`, 'bad');
    return false;
  }
}

async function ensureEvent() {
  if (state.eventId) return true;
  try {
    const events = await api('/events');
    if (events.length > 0) {
      state.eventId = events[0].id;
      log(`Using event #${state.eventId}: ${events[0].title}`, 'info');
      return true;
    }
  } catch { /* fall through */ }
  // seed one
  log('No events found — seeding demo event…', 'warn');
  try {
    const adminEmail = 'spike-admin@demo.com';
    try {
      await api('/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: adminEmail, password: 'spike123!', role: 'admin' }),
      });
    } catch { /* exists */ }
    const login = await api('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: adminEmail, password: 'spike123!' }),
    });
    const seatNumbers = ALL_SEATS; // 36 seats matching the map
    const ev = await api('/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${login.access_token}` },
      body: JSON.stringify({
        title: 'Flight AI-202 — 10 AM Spike',
        description: 'Spike demo event',
        venue: 'Terminal 2',
        starts_at: new Date(Date.now() + 86400000).toISOString(),
        seat_numbers: seatNumbers,
        price_per_seat: 250,
      }),
    });
    state.eventId = ev.id;
    log(`Seeded event #${ev.id} with ${seatNumbers.length} seats`, 'good');
    return true;
  } catch (e) {
    log(`Could not seed event: ${e.message}`, 'bad');
    return false;
  }
}

async function grabMySeat() {
  if (state.busy) return;
  state.busy = true;
  updateBookBtn();

  const ok = await ensureAuth();
  if (!ok) { state.busy = false; updateBookBtn(); return; }
  const evOk = await ensureEvent();
  if (!evOk) { state.busy = false; updateBookBtn(); return; }

  const seat = state.selectedSeat;
  log(`You are requesting seat ${seat}…`, 'info');

  try {
    const r = await api('/bookings/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.token}` },
      body: JSON.stringify({
        event_id: state.eventId,
        seat_numbers: [seat],
        idempotency_key: `my-${state.token.slice(-8)}-${seat}`,
        payment_method: 'demo',
      }),
    });
    state.mySeats.add(seat);
    state.seats[seat] = 'reserved';
    renderSeatMap();
    log(`Your request queued at position ${r.queue_position} (req #${r.request_id})`, 'good');
    // result shown when WS confirms
  } catch (e) {
    log(`Booking request failed: ${e.message}`, 'bad');
    showResult(false, e.message);
  } finally {
    state.busy = false;
    updateBookBtn();
  }
}

async function launchSpike() {
  if (state.spikeRunning) return;
  state.spikeRunning = true;
  updateSpikeBtn();
  const evOk = await ensureEvent();
  if (!evOk) { state.spikeRunning = false; updateSpikeBtn(); return; }
  log('Launching spike simulation…', 'spike');
  try {
    const r = await api('/spike/simulate?reset=true', { method: 'POST' });
    log(`Spike launched: ${r.users} fake users racing for event #${r.event_id}`, 'spike');
    // reset local seat map to available
    for (const s of Object.keys(state.seats)) state.seats[s] = 'available';
    state.mySeats.clear();
    state.stats = { queued: 0, confirmed: 0, failed: 0, total: 0 };
    renderSeatMap();
    renderStats();
  } catch (e) {
    log(`Spike failed: ${e.message}`, 'bad');
    state.spikeRunning = false;
    updateSpikeBtn();
  }
}

function showResult(success, msg) {
  const el = document.getElementById('result-box');
  if (!el) return;
  el.className = `result-box show ${success ? 'good' : 'bad'}`;
  el.textContent = msg;
}

function updateBookBtn() {
  const btn = document.getElementById('book-btn');
  if (btn) btn.disabled = state.busy;
}

function updateSpikeBtn() {
  const btn = document.getElementById('spike-btn');
  if (btn) {
    btn.disabled = state.spikeRunning;
    btn.textContent = state.spikeRunning ? '⚡ Spike running…' : '⚡ Fire spike now';
  }
}

// ── Render shell ──────────────────────────────────────────────────────────────
function renderShell() {
  document.getElementById('root').innerHTML = `
<main class="spike-shell">

  <div class="spike-hero">
    <div>
      <p class="eyebrow">10:00 AM Spike Simulator</p>
      <h1>Watch the booking war happen live.</h1>
      <p>Pick your seat, fire the spike, and watch the whole crowd race in real-time.</p>
    </div>
    <div class="countdown">
      <div class="countdown-time" id="countdown-time">--:--:--</div>
      <div class="countdown-label">until 10:00 AM spike</div>
    </div>
  </div>

  <div class="spike-stats">
    <div class="spike-stat"><div class="s-label">Users queued</div><div class="s-value" id="stat-queued">0</div></div>
    <div class="spike-stat"><div class="s-label">Confirmed</div><div class="s-value" id="stat-confirmed">0</div></div>
    <div class="spike-stat"><div class="s-label">Failed</div><div class="s-value" id="stat-failed">0</div></div>
    <div class="spike-stat"><div class="s-label">Total users</div><div class="s-value" id="stat-total">0</div></div>
  </div>

  <div class="spike-body">

    <!-- Live log -->
    <div class="log-panel-wrap">
      <div class="log-panel-header">
        <h2>Live booking stream <span id="ws-badge" class="log-badge">disconnected</span></h2>
        <span id="log-badge" class="log-badge">0 entries</span>
      </div>
      <div class="log-scroll" id="log-scroll">
        <div class="log-entry info"><span class="ts">--:--:--</span><span>Waiting for activity…</span></div>
      </div>
    </div>

    <!-- Right column -->
    <div class="right-col">

      <!-- Booking card -->
      <div class="booking-card">
        <h2>Grab your seat</h2>
        <div class="field-row">
          <label>Your email</label>
          <input id="email-input" type="email" value="${esc(state.email)}" />
        </div>
        <div class="field-row">
          <label>Seat (click map or type)</label>
          <input id="seat-input" type="text" value="${esc(state.selectedSeat)}" />
        </div>
        <button class="btn-primary" id="book-btn">🎟 Book my seat</button>
        <button class="btn-secondary" id="spike-btn">⚡ Fire spike now</button>
        <div class="result-box" id="result-box"></div>
      </div>

      <!-- Airplane seat map -->
      <div class="seat-map-card">
        <h2>✈ Seat map — Flight AI-202</h2>
        <div class="plane-body">
          <div class="plane-nose"></div>
          <div class="seat-grid" id="seat-grid"></div>
        </div>
        <div class="seat-legend">
          <span><span class="legend-dot" style="background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.15)"></span>Available</span>
          <span><span class="legend-dot" style="background:rgba(126,208,255,0.4)"></span>Selected</span>
          <span><span class="legend-dot" style="background:rgba(251,191,36,0.35)"></span>Reserved</span>
          <span><span class="legend-dot" style="background:rgba(248,113,113,0.45)"></span>Booked</span>
          <span><span class="legend-dot" style="background:rgba(74,222,128,0.5)"></span>Yours</span>
        </div>
      </div>

    </div>
  </div>

</main>`;

  // wire inputs
  document.getElementById('email-input').oninput = e => { state.email = e.target.value; };
  document.getElementById('seat-input').oninput = e => { state.selectedSeat = e.target.value.toUpperCase(); renderSeatMap(); };
  document.getElementById('book-btn').onclick = grabMySeat;
  document.getElementById('spike-btn').onclick = launchSpike;

  renderSeatMap();
  renderLogs();
  renderStats();
  updateWsBadge();
}

// ── Boot ──────────────────────────────────────────────────────────────────────
renderShell();
connectWS();
setInterval(tickCountdown, 500);
tickCountdown();

// sync seat map from backend every 5s
setInterval(async () => {
  if (!state.eventId) return;
  try {
    const seats = await api(`/events/${state.eventId}/seats`);
    let changed = false;
    for (const s of seats) {
      if (state.seats[s.seat_number] !== s.status) {
        state.seats[s.seat_number] = s.status;
        changed = true;
      }
    }
    if (changed) renderSeatMap();
  } catch { /* ignore */ }
}, 5000);
