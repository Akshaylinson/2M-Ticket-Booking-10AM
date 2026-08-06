# API Reference

## Auth

- `POST /auth/register`
- `POST /auth/login`
- `GET /auth/me`

## Events

- `POST /events`
- `GET /events`
- `GET /events/{event_id}`
- `GET /events/{event_id}/seats`

## Bookings

- `POST /bookings/request`
- `GET /bookings/{booking_ref}`
- `POST /bookings/{booking_ref}/cancel`

## Admin

- `GET /admin/overview`
- `GET /admin/requests`

## Observability

- `GET /healthz`
- `GET /readyz`
- `GET /metrics`
- `GET /prometheus`
- `WS /ws/updates`
