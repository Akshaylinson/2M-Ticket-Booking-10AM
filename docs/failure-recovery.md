# Failure Recovery

## Failure modes handled

- Payment failure: seats are released and booking is marked failed.
- Duplicate request: idempotency returns the existing booking request.
- Worker crash: queued requests remain durable in the database and can be retried.
- Lock expiry: holds time out and seats return to available.

## Recovery playbook

1. Inspect queue depth and failed booking metrics.
2. Restart workers if processing is halted.
3. Re-run stuck requests by request id.
4. Release stale reservations with the expiry job.

## Recommended hardening

- Add dead-letter queue support.
- Add database migrations.
- Persist queue state in Redis or RabbitMQ in production.
- Add retries with exponential backoff for transient failures.
