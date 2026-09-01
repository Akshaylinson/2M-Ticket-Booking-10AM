
﻿from __future__ import annotations

import asyncio
from datetime import datetime, timezone

from fastapi.testclient import TestClient

from app.db.base import Base
from app.db.session import SessionLocal, engine
from app.infra import BookingQueue, EventBroadcaster, Metrics, SeatLockManager
from app.main import app
from app.models import Booking, BookingRequest
from app.services import AuthService, BookingService, EventService, NotificationService, PaymentService, WorkerService


client = TestClient(app)


def reset_runtime_state() -> None:
    broadcaster = EventBroadcaster()
    metrics = Metrics()
    queue = BookingQueue()
    locks = SeatLockManager()
    payment = PaymentService()
    notifications = NotificationService(broadcaster, metrics)
    bookings = BookingService(queue, locks, broadcaster, metrics, payment, notifications)
    auth = AuthService()
    events = EventService()
    worker = WorkerService(queue, bookings)
    app.state.services.auth = auth
    app.state.services.events = events
    app.state.services.bookings = bookings
    app.state.services.payment = payment
    app.state.services.notifications = notifications
    app.state.services.metrics = metrics
    app.state.services.queue = queue
    app.state.services.locks = locks
    app.state.services.broadcaster = broadcaster
    app.state.worker = worker


def reset_db() -> None:
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    reset_runtime_state()


def auth_headers(email: str, password: str, role: str = 'user') -> dict[str, str]:
    register = client.post('/auth/register', json={'email': email, 'password': password, 'role': role})
    assert register.status_code == 200, register.text
    response = client.post('/auth/login', json={'email': email, 'password': password})
    assert response.status_code == 200, response.text
    token = response.json()['access_token']
    return {'Authorization': f'Bearer {token}'}


def create_admin() -> dict[str, str]:
    return auth_headers('admin@example.com', 'password123', 'admin')


def create_user(email: str = 'user@example.com') -> dict[str, str]:
    return auth_headers(email, 'password123', 'user')


def create_event(headers: dict[str, str]) -> int:
    response = client.post(
        '/events',
        headers=headers,
        json={
            'title': 'Concert Night',
            'description': 'Live concert',
            'venue': 'Arena',
            'starts_at': datetime.now(timezone.utc).isoformat(),
            'seat_numbers': ['A1', 'A2', 'A3'],
            'price_per_seat': 250.0,
        },
    )
    assert response.status_code == 200, response.text
    return response.json()['id']


def process_queue_request(request_id: int) -> None:
    asyncio.run(app.state.services.bookings.process_request(lambda: SessionLocal(), request_id))


def test_register_login_and_event_flow():
    reset_db()
    admin_headers = create_admin()
    event_id = create_event(admin_headers)
    response = client.get('/events')
    assert response.status_code == 200
    assert response.json()[0]['id'] == event_id


def test_booking_request_creates_queue_entry():
    reset_db()
    admin_headers = create_admin()
    event_id = create_event(admin_headers)
    user_headers = create_user()
    response = client.post(
        '/bookings/request',
        headers=user_headers,
        json={'event_id': event_id, 'seat_numbers': ['A1'], 'idempotency_key': 'abc123', 'payment_method': 'demo'},
    )
    assert response.status_code == 200, response.text
    data = response.json()
    assert data['status'] == 'queued'
    assert data['request_id'] > 0


def test_idempotent_requests_return_same_request():
    reset_db()
    admin_headers = create_admin()
    event_id = create_event(admin_headers)
    user_headers = create_user()
    first = client.post(
        '/bookings/request',
        headers=user_headers,
        json={'event_id': event_id, 'seat_numbers': ['A2'], 'idempotency_key': 'same-key', 'payment_method': 'demo'},
    )
    second = client.post(
        '/bookings/request',
        headers=user_headers,
        json={'event_id': event_id, 'seat_numbers': ['A2'], 'idempotency_key': 'same-key', 'payment_method': 'demo'},
    )
    assert first.json()['request_id'] == second.json()['request_id']


def test_booking_confirm_and_double_booking_prevented():
    reset_db()
    admin_headers = create_admin()
    event_id = create_event(admin_headers)
    user_headers = create_user('primary@example.com')
    response = client.post(
        '/bookings/request',
        headers=user_headers,
        json={'event_id': event_id, 'seat_numbers': ['A1'], 'idempotency_key': 'confirm-key', 'payment_method': 'demo'},
    )
    assert response.status_code == 200, response.text
    request_id = response.json()['request_id']
    process_queue_request(request_id)

    with SessionLocal() as db:
        booking_request = db.get(BookingRequest, request_id)
        assert booking_request is not None
        assert booking_request.status.value == 'confirmed'
        booking = db.scalar(
            __import__('sqlalchemy').select(Booking).where(Booking.id == booking_request.booking_id)
        )
        assert booking is not None
        assert booking.status.value == 'confirmed'

    second_user = create_user('other@example.com')
    second = client.post(
        '/bookings/request',
        headers=second_user,
        json={'event_id': event_id, 'seat_numbers': ['A1'], 'idempotency_key': 'another-key', 'payment_method': 'demo'},
    )
    assert second.status_code == 200, second.text
    second_request_id = second.json()['request_id']
    process_queue_request(second_request_id)
    with SessionLocal() as db:
        second_request = db.get(BookingRequest, second_request_id)
        assert second_request is not None
        assert second_request.status.value == 'failed'

















