# Scaling Strategy

## Request path

- Load balancer fans traffic across API replicas.
- Queue buffers booking spikes.
- Workers scale horizontally based on queue depth.

## Booking safety

- Redis-style seat locks keep concurrent workers from racing the same seat.
- Database transactions and unique constraints are the final source of truth.
- Idempotency keys make retries safe.

## Read scaling

- Add read replicas for browse and reporting traffic.
- Cache event and seat-map reads.
- Keep write traffic centralized in the primary database.

## Operational scaling

- Autoscale workers when queue length rises.
- Monitor booking latency, failed bookings, duplicate attempts, and queue depth.
- Use WebSockets only for live updates, not core booking correctness.
