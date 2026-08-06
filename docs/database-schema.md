# Database Schema

## Tables

- `users`
- `events`
- `seats`
- `booking_requests`
- `bookings`
- `booking_seats`
- `payments`
- `notifications`
- `audit_logs`

## Important constraints

- `users.email` is unique.
- `seats` has a unique `(event_id, seat_number)` pair.
- `booking_requests` has a unique `(user_id, idempotency_key)` pair.
- `bookings.idempotency_key` is unique.
- `payments.booking_id` is unique.

## Seat state machine

- `available`
- `reserved`
- `booked`

## Booking state machine

- `queued`
- `processing`
- `confirmed`
- `cancelled`
- `failed`

## Notes

The schema is intentionally compact so the locking and concurrency story is easy to reason about in interviews and in production.
