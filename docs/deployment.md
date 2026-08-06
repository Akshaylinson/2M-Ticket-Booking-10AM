# Deployment Guide

## Local backend

1. `cd backend`
2. Create and activate a virtual environment.
3. `pip install -e ".[dev]"`
4. `uvicorn app.main:app --reload`

## Local frontend

1. `cd frontend`
2. `npm install`
3. `npm run dev`

## Docker Compose

Use the root `docker-compose.yml` to run PostgreSQL, Redis, the FastAPI backend, and the React dashboard together.

## Environment variables

- `DATABASE_URL`
- `REDIS_URL`
- `SECRET_KEY`
- `ACCESS_TOKEN_MINUTES`
- `BOOKING_HOLD_SECONDS`
