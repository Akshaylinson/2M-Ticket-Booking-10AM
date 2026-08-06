# 2M Ticket Booking

A production-oriented distributed ticket booking platform inspired by IRCTC, Ticketmaster, and BookMyShow.

The project was built from `core.md` and `build.md` and now includes:

- JWT auth
- Event and seat management
- Queue-based booking processing
- Booking idempotency and seat locking
- Payment simulation
- Admin overview and metrics
- WebSocket update hooks
- React + Vite dashboard scaffold
- Docker Compose deployment
- Architecture, API, schema, and scaling docs
- Load testing script

## Layout

- `backend/` FastAPI service, SQLAlchemy models, worker, and tests
- `frontend/` React + Vite dashboard
- `docs/` architecture and deployment documentation
- `loadtest/` k6 booking stress script
- `docker-compose.yml` local stack with Postgres and Redis

## Backend

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -e ".[dev]"
uvicorn app.main:app --reload
```

## Tests

```bash
cd backend
pytest
```

## Frontend

```bash
cd frontend
npm install
npm run dev
```

## Docker Compose

```bash
docker compose up --build
```

## API

- `POST /auth/register`
- `POST /auth/login`
- `GET /auth/me`
- `POST /events`
- `GET /events`
- `GET /events/{event_id}`
- `GET /events/{event_id}/seats`
- `POST /bookings/request`
- `GET /bookings/{booking_ref}`
- `POST /bookings/{booking_ref}/cancel`
- `GET /admin/overview`
- `GET /metrics`
- `GET /prometheus`
- `GET /healthz`
- `GET /readyz`
- `WS /ws/updates`

## Docs

- [Architecture](docs/architecture.md)
- [Database Schema](docs/database-schema.md)
- [API Reference](docs/api.md)
- [Sequence Diagrams](docs/sequence-diagrams.md)
- [Deployment Guide](docs/deployment.md)
- [Scaling Strategy](docs/scaling.md)
- [Failure Recovery](docs/failure-recovery.md)
- [Load Testing](docs/load-testing.md)

## Notes

- The backend uses SQLite by default for local development and tests.
- The Docker Compose stack switches the backend to PostgreSQL.
- Redis and Kafka/RabbitMQ are represented by production-friendly abstractions so the design is ready for swapping in external infrastructure.
