import { useEffect, useState } from 'react';

type Overview = {
  active_users: number;
  queue_length: number;
  worker_status: string;
  bookings_confirmed: number;
  bookings_failed: number;
  duplicate_booking_attempts: number;
  seat_occupancy: number;
  redis_health: string;
  database_health: string;
};

type EventItem = {
  id: number;
  title: string;
  venue: string;
  starts_at: string;
  total_seats: number;
};

const apiBase = import.meta.env.VITE_API_BASE_URL ?? '/api';

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(`${apiBase}${path}`);
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

function StatCard({ label, value, hint }: { label: string; value: string | number; hint: string }) {
  return (
    <section className="stat-card">
      <span className="stat-label">{label}</span>
      <strong className="stat-value">{value}</strong>
      <span className="stat-hint">{hint}</span>
    </section>
  );
}

export default function App() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    Promise.all([fetchJson<Overview>('/admin/overview'), fetchJson<EventItem[]>('/events'), fetchJson<{ status: string }>('/healthz')])
      .then(([overviewData, eventsData]) => {
        if (!mounted) return;
        setOverview(overviewData);
        setEvents(eventsData);
      })
      .catch((err: unknown) => {
        if (!mounted) return;
        setError(err instanceof Error ? err.message : 'Failed to load dashboard data');
      });

    return () => {
      mounted = false;
    };
  }, []);

  return (
    <main className="shell">
      <header className="hero">
        <div>
          <p className="eyebrow">Distributed Ticket Booking</p>
          <h1>2M booking requests, one clean booking flow.</h1>
          <p className="lede">
            Queue-first architecture, seat locks, idempotency, and live operator visibility for a platform built to avoid double booking.
          </p>
        </div>
        <div className="hero-panel">
          <span>System status</span>
          <strong>{error ? 'degraded' : 'ready'}</strong>
          <p>{error ?? 'Backend reachable and dashboard hydrated.'}</p>
        </div>
      </header>

      <section className="stats-grid">
        <StatCard label="Users" value={overview?.active_users ?? '—'} hint="registered accounts" />
        <StatCard label="Queue" value={overview?.queue_length ?? '—'} hint="pending booking jobs" />
        <StatCard label="Confirmed" value={overview?.bookings_confirmed ?? '—'} hint="successful bookings" />
        <StatCard label="Failures" value={overview?.bookings_failed ?? '—'} hint="payment or lock failures" />
      </section>

      <section className="content-grid">
        <article className="panel">
          <h2>Operational health</h2>
          <dl className="health-list">
            <div>
              <dt>Worker</dt>
              <dd>{overview?.worker_status ?? '—'}</dd>
            </div>
            <div>
              <dt>Redis</dt>
              <dd>{overview?.redis_health ?? '—'}</dd>
            </div>
            <div>
              <dt>Database</dt>
              <dd>{overview?.database_health ?? '—'}</dd>
            </div>
            <div>
              <dt>Seat occupancy</dt>
              <dd>{overview ? `${overview.seat_occupancy.toFixed(1)}%` : '—'}</dd>
            </div>
          </dl>
        </article>

        <article className="panel accent">
          <h2>Booking safety layers</h2>
          <ul className="stack-list">
            <li>Idempotency key per booking request</li>
            <li>Seat-level distributed lock abstraction</li>
            <li>Database transaction with unique constraints</li>
            <li>Worker-based queue processing</li>
            <li>Payment success or rollback path</li>
          </ul>
        </article>
      </section>

      <section className="panel full-width">
        <div className="section-header">
          <h2>Live events</h2>
          <span>{events.length} events loaded</span>
        </div>
        <div className="event-list">
          {events.length === 0 ? (
            <p className="empty">No events yet. Create one through the API to populate the dashboard.</p>
          ) : (
            events.map((event) => (
              <article key={event.id} className="event-card">
                <strong>{event.title}</strong>
                <span>{event.venue}</span>
                <span>{new Date(event.starts_at).toLocaleString()}</span>
                <span>{event.total_seats} seats</span>
              </article>
            ))
          )}
        </div>
      </section>
    </main>
  );
}
