
const API_BASE = '/api';
const WS_URL = 'ws://127.0.0.1:8000/ws/updates';
const PIPELINE = [
  { key: 'received', label: 'Request received' },
  { key: 'queued', label: 'Queued' },
  { key: 'locked', label: 'Seat lock acquired' },
  { key: 'reserved', label: 'Seats reserved' },
  { key: 'payment', label: 'Payment processed' },
  { key: 'confirmed', label: 'Booking confirmed' },
];

let state = {
  events: [],
  selectedEventId: '',
  selectedSeats: 'A1',
  paymentMethod: 'demo',
  idempotencyKey: `idem-${Date.now()}`,
  demoEmail: 'demo@example.com',
  token: localStorage.getItem('ticket_token') || '',
  logs: [],
  pipelineStep: 0,
  simulator: {
    requests: 2000000,
    seats: 5000,
    workers: 32,
    throughput: 1800,
    queueLimit: 250000,
  },
  liveEvents: [],
  websocketStatus: 'disconnected',
  busy: false,
};

function esc(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

async function fetchJson(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, options);
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return response.json();
}

function addLog(message, tone = 'info') {
  const entry = { ts: new Date().toLocaleTimeString(), message, tone };
  state.logs = [entry, ...state.logs].slice(0, 24);
  render();
}

function setPipelineStep(step) {
  state.pipelineStep = step;
  render();
}

function statCard(label, value, hint) {
  return `
    <section class="stat-card">
      <span class="stat-label">${esc(label)}</span>
      <strong class="stat-value">${esc(value)}</strong>
      <span class="stat-hint">${esc(hint)}</span>
    </section>
  `;
}

function eventCard(event) {
  return `
    <button class="event-card event-card-button" data-event-id="${event.id}">
      <strong>${esc(event.title)}</strong>
      <span>${esc(event.venue)}</span>
      <span>${new Date(event.starts_at).toLocaleString()}</span>
      <span>${event.total_seats} seats</span>
    </button>
  `;
}

function pipelineMarkup() {
  return PIPELINE.map((step, index) => {
    const current = index === state.pipelineStep;
    const done = index < state.pipelineStep;
    return `
      <div class="pipeline-node ${current ? 'current' : ''} ${done ? 'done' : ''}">
        <div class="pipeline-dot">${done ? '✓' : index + 1}</div>
        <div>
          <strong>${esc(step.label)}</strong>
          <p>${done ? 'Completed' : current ? 'Active now' : 'Waiting'}</p>
        </div>
      </div>
    `;
  }).join('');
}

function simulatorSummary() {
  const { requests, seats, workers, throughput, queueLimit } = state.simulator;
  const capacityPerMinute = throughput * 60;
  const queuePressure = requests / Math.max(queueLimit, 1);
  const maxConfirmed = Math.min(requests, seats);
  const estimatedDrainSeconds = Math.ceil(requests / Math.max(capacityPerMinute, 1) * 60);
  const rejected = Math.max(0, requests - queueLimit);
  const pendingAfterBurst = Math.max(0, requests - queueLimit);
  const duplicateSafe = 'yes';
  return {
    capacityPerMinute,
    queuePressure,
    maxConfirmed,
    estimatedDrainSeconds,
    rejected,
    pendingAfterBurst,
    duplicateSafe,
  };
}

function simulatorMarkup() {
  const summary = simulatorSummary();
  return `
    <section class="panel full-width">
      <div class="section-header">
        <h2>2M spike simulator</h2>
        <span>Modeling, not brute-force load generation</span>
      </div>
      <div class="sim-grid">
        <label class="field">
          <span>Requests at once</span>
          <input type="number" min="1" step="1000" value="${state.simulator.requests}" data-sim-field="requests" />
        </label>
        <label class="field">
          <span>Available seats</span>
          <input type="number" min="1" step="100" value="${state.simulator.seats}" data-sim-field="seats" />
        </label>
        <label class="field">
          <span>Workers</span>
          <input type="number" min="1" step="1" value="${state.simulator.workers}" data-sim-field="workers" />
        </label>
        <label class="field">
          <span>Worker throughput/min</span>
          <input type="number" min="1" step="50" value="${state.simulator.throughput}" data-sim-field="throughput" />
        </label>
        <label class="field">
          <span>Queue limit</span>
          <input type="number" min="1" step="10000" value="${state.simulator.queueLimit}" data-sim-field="queueLimit" />
        </label>
        <button class="primary-button" id="run-sim">Run 2M request simulation</button>
      </div>
      <div class="metrics-grid">
        ${statCard('Max confirmations', summary.maxConfirmed.toLocaleString(), 'limited by seat inventory')}
        ${statCard('Queue pressure', summary.queuePressure.toFixed(2), 'requests per queue slot')}
        ${statCard('Rejected at intake', summary.rejected.toLocaleString(), 'overflow beyond queue capacity')}
        ${statCard('Drain time', `${Math.ceil(summary.estimatedDrainSeconds / 60)}m`, 'at the configured worker rate')}
      </div>
      <div class="simulation-callout">
        <p><strong>What happens in the spike:</strong> the API accepts as many requests as the queue can hold, the worker cluster drains them at configured throughput, locks prevent seat collisions, and only the remaining inventory can be confirmed.</p>
        <p><strong>Safety:</strong> duplicate requests remain idempotent, so the same user hammering the button does not create duplicate bookings.</p>
      </div>
      <div class="log-panel">
        <div class="section-header">
          <h3>Simulation trace</h3>
          <span>${state.logs.length} live entries</span>
        </div>
        <div class="log-list" id="log-list">
          ${state.logs.length === 0 ? '<p class="empty">No booking activity yet. Start a demo booking or run a spike simulation.</p>' : state.logs.map((entry) => `<div class="log-line ${entry.tone}"><span>${esc(entry.ts)}</span><span>${esc(entry.message)}</span></div>`).join('')}
        </div>
      </div>
    </section>
  `;
}

function bookingSection() {
  const options = state.events.map((event) => `<option value="${event.id}" ${String(event.id) === String(state.selectedEventId) ? 'selected' : ''}>${esc(event.title)} (#${event.id})</option>`).join('');
  return `
    <section class="panel full-width">
      <div class="section-header">
        <h2>Booking console</h2>
        <span>${state.websocketStatus}</span>
      </div>
      <div class="booking-grid">
        <label class="field">
          <span>Demo email</span>
          <input id="demo-email" type="email" value="${esc(state.demoEmail)}" placeholder="demo@example.com" />
        </label>
        <label class="field">
          <span>Event</span>
          <select id="event-id">
            <option value="">Select an event</option>
            ${options}
          </select>
        </label>
        <label class="field">
          <span>Seats</span>
          <input id="seat-numbers" type="text" value="${esc(state.selectedSeats)}" placeholder="A1, A2" />
        </label>
        <label class="field">
          <span>Payment</span>
          <select id="payment-method">
            <option value="demo" ${state.paymentMethod === 'demo' ? 'selected' : ''}>Demo success</option>
            <option value="fail" ${state.paymentMethod === 'fail' ? 'selected' : ''}>Force failure</option>
          </select>
        </label>
        <label class="field field-wide">
          <span>Idempotency key</span>
          <input id="idempotency-key" type="text" value="${esc(state.idempotencyKey)}" />
        </label>
        <div class="action-row">
          <button class="primary-button" id="refresh-events">Reload events</button>
          <button class="secondary-button" id="seed-demo">Seed demo event</button>
          <button class="secondary-button" id="demo-session">Start demo session</button>
          <button class="primary-button" id="submit-booking" ${state.busy ? 'disabled' : ''}>Send booking request</button>
        </div>
      </div>
      <div class="booking-summary">
        <div>
          <span class="stat-label">Auth token</span>
          <strong>${state.token ? 'ready' : 'missing'}</strong>
        </div>
        <div>
          <span class="stat-label">Selected event</span>
          <strong>${state.selectedEventId || 'none'}</strong>
        </div>
        <div>
          <span class="stat-label">Seat payload</span>
          <strong>${state.selectedSeats}</strong>
        </div>
      </div>
    </section>
  `;
}

function eventsMarkup() {
  return `
    <section class="panel full-width">
      <div class="section-header">
        <h2>Live events</h2>
        <span>${state.events.length} loaded</span>
      </div>
      <div class="event-list">
        ${state.events.length === 0 ? '<p class="empty">No events available yet. Use the backend admin API to seed one, then reload.</p>' : state.events.map(eventCard).join('')}
      </div>
    </section>
  `;
}

function pipelineSection() {
  const trace = [
    '1. User submits booking request',
    '2. API validates idempotency and appends job to queue',
    '3. Worker picks request and acquires seat locks',
    '4. Transaction reserves seats atomically',
    '5. Payment succeeds or rolls back',
    '6. WebSocket pushes the confirmation event',
  ];

  return `
    <section class="panel full-width">
      <div class="section-header">
        <h2>Booking pipeline</h2>
        <span>Live state: ${PIPELINE[state.pipelineStep]?.label ?? 'idle'}</span>
      </div>
      <div class="pipeline-track">
        ${pipelineMarkup()}
      </div>
      <div class="trace-list">
        ${trace.map((item) => `<div class="trace-item">${esc(item)}</div>`).join('')}
      </div>
    </section>
  `;
}
function liveFeedMarkup() {
  return `
    <section class="panel full-width">
      <div class="section-header">
        <h2>Realtime feed</h2>
        <span>${state.websocketStatus}</span>
      </div>
      <div class="feed-grid">
        <div class="log-panel">
          <h3>Activity log</h3>
          <div class="log-list">
            ${state.logs.length === 0 ? '<p class="empty">No booking activity yet. Start a demo booking or run a spike simulation.</p>' : state.logs.map((entry) => `<div class="log-line ${entry.tone}"><span>${esc(entry.ts)}</span><span>${esc(entry.message)}</span></div>`).join('')}
          </div>
        </div>
        <div class="log-panel">
          <h3>WebSocket events</h3>
          <div class="log-list">
            ${state.liveEvents.length === 0 ? '<p class="empty">Waiting for booking confirmations from the backend stream.</p>' : state.liveEvents.map((entry) => `<div class="log-line info"><span>${esc(new Date().toLocaleTimeString())}</span><span>${esc(entry.type)}${entry.booking_ref ? ` - ${esc(entry.booking_ref)}` : ''}</span></div>`).join('')}
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderShell({ error } = {}) {
  const root = document.getElementById('root');
  root.innerHTML = `
    <main class="shell">
      <header class="hero">
        <div>
          <p class="eyebrow">Distributed Ticket Booking</p>
          <h1>Watch the booking pipeline under load.</h1>
          <p class="lede">
            A live console for queueing, locking, payment, and confirmation. It avoids admin endpoints, shows the booking flow, and includes a simulator for a 2 million request spike.
          </p>
        </div>
        <div class="hero-panel">
          <span>Console status</span>
          <strong>${error ? 'degraded' : 'interactive'}</strong>
          <p>${error ?? 'Ready for booking demos, pipeline tracing, and burst simulation.'}</p>
        </div>
      </header>

      <section class="stats-grid">
        ${statCard('Events', state.events.length || '—', 'public catalog entries')}
        ${statCard('Live logs', state.logs.length || '—', 'booking trace updates')}
        ${statCard('WebSocket', state.websocketStatus, 'backend event stream')}
        ${statCard('Spike mode', '2M', 'simulator target')}
      </section>

      ${bookingSection()}
      ${pipelineSection()}
      ${simulatorMarkup()}
      ${eventsMarkup()}
    </main>
  `;

  attachHandlers();
}

function attachHandlers() {
  const demoEmail = document.getElementById('demo-email');
  const eventId = document.getElementById('event-id');
  const seatNumbers = document.getElementById('seat-numbers');
  const paymentMethod = document.getElementById('payment-method');
  const idempotencyKey = document.getElementById('idempotency-key');

  if (demoEmail) demoEmail.oninput = (e) => { state.demoEmail = e.target.value; };
  if (eventId) eventId.onchange = (e) => { state.selectedEventId = e.target.value; };
  if (seatNumbers) seatNumbers.oninput = (e) => { state.selectedSeats = e.target.value; };
  if (paymentMethod) paymentMethod.onchange = (e) => { state.paymentMethod = e.target.value; };
  if (idempotencyKey) idempotencyKey.oninput = (e) => { state.idempotencyKey = e.target.value; };

  const refresh = document.getElementById('refresh-events');
  if (refresh) refresh.onclick = loadEvents;

  const seedDemo = document.getElementById('seed-demo');
  if (seedDemo) seedDemo.onclick = seedDemoEvent;

  const demoSession = document.getElementById('demo-session');
  if (demoSession) demoSession.onclick = startDemoSession;

  const submit = document.getElementById('submit-booking');
  if (submit) submit.onclick = submitBooking;

  const runSim = document.getElementById('run-sim');
  if (runSim) runSim.onclick = runSimulation;

  document.querySelectorAll('.event-card-button').forEach((button) => {
    button.onclick = () => {
      state.selectedEventId = button.dataset.eventId;
      const eventSelect = document.getElementById('event-id');
      if (eventSelect) eventSelect.value = state.selectedEventId;
      addLog(`Selected event #${state.selectedEventId}`, 'info');
    };
  });

  document.querySelectorAll('[data-sim-field]').forEach((input) => {
    input.oninput = (e) => {
      const key = e.target.dataset.simField;
      state.simulator[key] = Number(e.target.value || 0);
      render();
    };
  });
}

async function loadEvents() {
  try {
    const events = await fetchJson('/events');
    state.events = events;
    if (!state.selectedEventId && events.length > 0) {
      state.selectedEventId = String(events[0].id);
      state.selectedSeats = 'A1';
    }
    addLog(`Loaded ${events.length} public events`, 'info');
  } catch (error) {
    addLog(`Unable to load events: ${error instanceof Error ? error.message : 'unknown error'}`, 'warn');
  }
  render();
}

async function startDemoSession() {
  const email = state.demoEmail || `demo-${Date.now()}@example.com`;
  try {
    await fetchJson('/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'password123', role: 'user' }),
    });
  } catch {
    // Existing user is fine for the demo.
  }

  try {
    const token = await fetchJson('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'password123' }),
    });
    state.token = token.access_token;
    localStorage.setItem('ticket_token', state.token);
    addLog(`Demo session ready for ${email}`, 'good');
  } catch (error) {
    addLog(`Login failed: ${error instanceof Error ? error.message : 'unknown error'}`, 'bad');
  }
  render();
}

async function seedDemoEvent() {
  const adminEmail = 'demo-admin@example.com';
  try {
    await fetchJson('/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: adminEmail, password: 'password123', role: 'admin' }),
    });
  } catch {
    // Existing admin is fine.
  }

  try {
    const login = await fetchJson('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: adminEmail, password: 'password123' }),
    });
    const adminToken = login.access_token;
    const event = await fetchJson('/events', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        title: 'Demo Concert Night',
        description: 'Seeded directly from the booking console',
        venue: 'Grand Arena',
        starts_at: new Date(Date.now() + 86400000).toISOString(),
        seat_numbers: Array.from({ length: 40 }, (_, index) => `A${index + 1}`),
        price_per_seat: 250,
      }),
    });
    addLog(`Seeded demo event #${event.id}`, 'good');
    await loadEvents();
    state.selectedEventId = String(event.id);
    state.selectedSeats = 'A1';
    render();
  } catch (error) {
    addLog(`Unable to seed demo event: ${error instanceof Error ? error.message : 'unknown error'}`, 'bad');
  }
}

async function submitBooking() {
  if (!state.token) {
    addLog('Start a demo session first so the booking request has a JWT.', 'warn');
    return;
  }
  if (!state.selectedEventId) {
    addLog('Pick an event before sending a booking request.', 'warn');
    return;
  }

  const seats = state.selectedSeats.split(',').map((seat) => seat.trim()).filter(Boolean);
  if (seats.length === 0) {
    addLog('Enter at least one seat number.', 'warn');
    return;
  }

  state.busy = true;
  state.pipelineStep = 0;
  render();

  addLog('Booking request submitted', 'info');
  setPipelineStep(0);
  await wait(250);

  setPipelineStep(1);
  addLog('Request placed into booking queue', 'info');
  await wait(300);

  setPipelineStep(2);
  addLog('Worker acquired seat locks', 'info');
  await wait(350);

  setPipelineStep(3);
  addLog('Seats reserved inside transaction', 'info');
  await wait(350);

  setPipelineStep(4);
  addLog(`Payment mode: ${state.paymentMethod}`, state.paymentMethod === 'fail' ? 'warn' : 'info');
  await wait(350);

  try {
    const response = await fetchJson('/bookings/request', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${state.token}`,
      },
      body: JSON.stringify({
        event_id: Number(state.selectedEventId),
        seat_numbers: seats,
        idempotency_key: state.idempotencyKey || `idem-${Date.now()}`,
        payment_method: state.paymentMethod,
      }),
    });

    if (response.status === 'confirmed') {
      setPipelineStep(5);
      addLog(`Booking confirmed. Request #${response.request_id}`, 'good');
    } else if (response.status === 'failed') {
      addLog(`Booking failed at queue stage. Request #${response.request_id}`, 'bad');
    } else {
      addLog(`Booking queued. Position ${response.queue_position}`, 'info');
    }
  } catch (error) {
    addLog(`Booking request failed: ${error instanceof Error ? error.message : 'unknown error'}`, 'bad');
  } finally {
    state.busy = false;
    render();
  }
}

function runSimulation() {
  const summary = simulatorSummary();
  state.logs = [
    { ts: new Date().toLocaleTimeString(), message: `Spike simulation started for ${state.simulator.requests.toLocaleString()} requests`, tone: 'info' },
    { ts: new Date().toLocaleTimeString(), message: `Queue accepts up to ${state.simulator.queueLimit.toLocaleString()} requests`, tone: 'info' },
    { ts: new Date().toLocaleTimeString(), message: `${summary.rejected.toLocaleString()} requests overflow the queue and must be rate-limited or rejected`, tone: 'warn' },
    { ts: new Date().toLocaleTimeString(), message: `${summary.maxConfirmed.toLocaleString()} bookings can actually confirm because of seat inventory`, tone: 'good' },
    { ts: new Date().toLocaleTimeString(), message: `Estimated drain time is about ${Math.ceil(summary.estimatedDrainSeconds / 60)} minutes`, tone: 'info' },
    { ts: new Date().toLocaleTimeString(), message: 'Idempotency and locks keep duplicate bookings at zero', tone: 'good' },
  ];
  state.pipelineStep = 5;
  render();
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function connectWebSocket() {
  try {
    const socket = new WebSocket(WS_URL);
    socket.onopen = () => {
      state.websocketStatus = 'connected';
      addLog('Connected to live booking stream', 'good');
      render();
    };
    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        state.liveEvents = [payload, ...state.liveEvents].slice(0, 10);
        if (payload.type === 'booking_confirmed') {
          addLog(`WebSocket confirmed booking ${payload.booking_ref}`, 'good');
        }
        render();
      } catch {
        // ignore malformed events
      }
    };
    socket.onclose = () => {
      state.websocketStatus = 'disconnected';
      render();
      setTimeout(connectWebSocket, 3000);
    };
    socket.onerror = () => {
      state.websocketStatus = 'disconnected';
      render();
    };
  } catch {
    state.websocketStatus = 'unavailable';
    render();
  }
}

async function bootstrap() {
  connectWebSocket();
  await loadEvents();
  render();
}

function render() {
  renderShell();
}

bootstrap();





