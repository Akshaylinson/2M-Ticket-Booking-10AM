from __future__ import annotations

import asyncio
import random
import string
from types import SimpleNamespace
from typing import Annotated

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.core.config import get_settings
from app.core.security import decode_token
from app.db.base import Base
from app.db.session import SessionLocal, engine, get_db
from app.infra import BookingQueue, EventBroadcaster, Metrics, SeatLockManager
from app.models import Booking, BookingRequest, BookingStatus, Event, Seat, SeatStatus, User, UserRole
from app.schemas import (
    AdminOverview,
    BookingQueueResponse,
    BookingRead,
    BookingRequestCreate,
    BookingRequestRead,
    EventCreate,
    EventRead,
    HealthResponse,
    LoginRequest,
    MetricsResponse,
    SeatRead,
    TokenResponse,
    UserCreate,
    UserRead,
)
from app.services import AuthService, BookingService, EventService, NotificationService, PaymentService, WorkerService


settings = get_settings()
oauth2_scheme = OAuth2PasswordBearer(tokenUrl='/auth/login')

auth_router = APIRouter(prefix='/auth', tags=['auth'])
events_router = APIRouter(prefix='/events', tags=['events'])
bookings_router = APIRouter(prefix='/bookings', tags=['bookings'])
admin_router = APIRouter(prefix='/admin', tags=['admin'])
health_router = APIRouter(tags=['health'])
ws_router = APIRouter(tags=['websocket'])
metrics_router = APIRouter(tags=['metrics'])
spike_router = APIRouter(prefix='/spike', tags=['spike'])


def get_app_services(app: FastAPI):
    return app.state.services


def get_current_user(token: Annotated[str, Depends(oauth2_scheme)], db: Session = Depends(get_db)) -> User:
    try:
        payload = decode_token(token, settings.secret_key)
        user_id = int(payload['sub'])
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='Invalid token') from exc
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='User not found')
    return user


def require_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != UserRole.admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='Admin access required')
    return user


@auth_router.post('/register', response_model=UserRead)
def register(payload: UserCreate, db: Session = Depends(get_db), request: Request = None) -> User:
    return get_app_services(request.app).auth.register(db, payload.email, payload.password, payload.role)


@auth_router.post('/login', response_model=TokenResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db), request: Request = None) -> TokenResponse:
    token = get_app_services(request.app).auth.login(db, payload.email, payload.password)
    return TokenResponse(access_token=token)


@auth_router.get('/me', response_model=UserRead)
def me(user: User = Depends(get_current_user)) -> User:
    return user


@events_router.post('', response_model=EventRead, dependencies=[Depends(require_admin)])
def create_event(payload: EventCreate, db: Session = Depends(get_db), request: Request = None, admin: User = Depends(require_admin)) -> Event:
    seat_numbers = payload.seat_numbers or [f'S{i}' for i in range(1, payload.seat_count + 1)]
    return get_app_services(request.app).events.create_event(
        db,
        creator_id=admin.id,
        title=payload.title,
        description=payload.description,
        venue=payload.venue,
        starts_at=payload.starts_at,
        seat_numbers=seat_numbers,
        price_per_seat=payload.price_per_seat,
    )


@events_router.get('', response_model=list[EventRead])
def list_events(db: Session = Depends(get_db), request: Request = None) -> list[Event]:
    return get_app_services(request.app).events.list_events(db)


@events_router.get('/{event_id}', response_model=EventRead)
def get_event(event_id: int, db: Session = Depends(get_db), request: Request = None) -> Event:
    return get_app_services(request.app).events.get_event(db, event_id)


@events_router.get('/{event_id}/seats', response_model=list[SeatRead])
def get_seats(event_id: int, db: Session = Depends(get_db), request: Request = None) -> list[Seat]:
    return get_app_services(request.app).events.list_seats(db, event_id)


@bookings_router.post('/request', response_model=BookingQueueResponse)
async def request_booking(
    payload: BookingRequestCreate,
    db: Session = Depends(get_db),
    request: Request = None,
    user: User = Depends(get_current_user),
) -> BookingQueueResponse:
    booking_request = await get_app_services(request.app).bookings.enqueue(
        db,
        user_id=user.id,
        event_id=payload.event_id,
        seat_numbers=payload.seat_numbers,
        idempotency_key=payload.idempotency_key,
        payment_method=payload.payment_method,
    )
    return BookingQueueResponse(
        request_id=booking_request.id,
        status=booking_request.status,
        queue_position=booking_request.queue_position,
        message='Booking request queued',
    )


@bookings_router.get('/{booking_ref}', response_model=BookingRead)
def get_booking(booking_ref: str, db: Session = Depends(get_db)) -> Booking:
    booking = db.scalar(
        select(Booking).where(Booking.booking_ref == booking_ref).options(selectinload(Booking.seats), selectinload(Booking.payment))
    )
    if not booking:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Booking not found')
    return booking


@bookings_router.post('/{booking_ref}/cancel', response_model=BookingRead)
def cancel_booking(booking_ref: str, db: Session = Depends(get_db), request: Request = None, user: User = Depends(get_current_user)) -> Booking:
    return get_app_services(request.app).bookings.cancel_booking(db, booking_ref, actor_id=user.id)


@admin_router.get('/overview', response_model=AdminOverview, dependencies=[Depends(require_admin)])
def overview(db: Session = Depends(get_db), request: Request = None) -> AdminOverview:
    total_users = db.scalar(select(func.count(User.id))) or 0
    confirmed = db.scalar(select(func.count(Booking.id)).where(Booking.status == BookingStatus.confirmed)) or 0
    failed = db.scalar(select(func.count(Booking.id)).where(Booking.status == BookingStatus.failed)) or 0
    seats_total = db.scalar(select(func.count(Seat.id))) or 0
    seats_booked = db.scalar(select(func.count(Seat.id)).where(Seat.status == SeatStatus.booked)) or 0
    queue_length = get_app_services(request.app).queue.size()
    metrics = get_app_services(request.app).metrics
    return AdminOverview(
        active_users=total_users,
        queue_length=queue_length,
        worker_status='running' if request.app.state.worker and request.app.state.worker.running else 'stopped',
        bookings_confirmed=confirmed,
        bookings_failed=failed,
        duplicate_booking_attempts=int(metrics.snapshot().get('duplicate_booking_attempts', 0)),
        seat_occupancy=(seats_booked / seats_total * 100.0) if seats_total else 0.0,
        redis_health='ok',
        database_health='ok',
    )


@admin_router.get('/requests', response_model=list[BookingRequestRead], dependencies=[Depends(require_admin)])
def list_requests(db: Session = Depends(get_db)) -> list[BookingRequest]:
    return list(db.scalars(select(BookingRequest).order_by(BookingRequest.created_at.desc())))


@health_router.get('/healthz', response_model=HealthResponse)
def healthz() -> HealthResponse:
    return HealthResponse(status='ok', service='ticket-booking-api')


@health_router.get('/readyz', response_model=HealthResponse)
def readyz() -> HealthResponse:
    return HealthResponse(status='ready', service='ticket-booking-api')


@metrics_router.get('/metrics', response_model=MetricsResponse)
def metrics(request: Request = None) -> MetricsResponse:
    return MetricsResponse(metrics=get_app_services(request.app).metrics.snapshot())


@metrics_router.get('/prometheus')
def prometheus(request: Request = None):
    return PlainTextResponse(get_app_services(request.app).metrics.to_prometheus())


@ws_router.websocket('/ws/updates')
async def websocket_updates(websocket: WebSocket):
    await websocket.accept()
    broadcaster = websocket.app.state.services.broadcaster
    try:
        async for event in broadcaster.subscribe():
            await websocket.send_json(event)
    except WebSocketDisconnect:
        return


@spike_router.post('/simulate')
async def spike_simulate(request: Request, db: Session = Depends(get_db), reset: bool = False):
    """Fire a burst of fake booking requests to simulate a 10:00 AM spike."""
    services = get_app_services(request.app)
    broadcaster = services.broadcaster

    # Pick the event with the most available seats
    from sqlalchemy import func as sqlfunc
    event_id_with_most = db.scalar(
        select(Seat.event_id)
        .where(Seat.status == SeatStatus.available)
        .group_by(Seat.event_id)
        .order_by(sqlfunc.count(Seat.id).desc())
        .limit(1)
    )

    # If reset=true or no available seats found, reset all seats on the first event
    if reset or event_id_with_most is None:
        first_event = db.scalar(select(Event).order_by(Event.id.asc()))
        if not first_event:
            raise HTTPException(status_code=400, detail='No events found. Seed a demo event first.')
        db.execute(
            Seat.__table__.update()
            .where(Seat.__table__.c.event_id == first_event.id)
            .values(status=SeatStatus.available, reserved_by_user_id=None, reserved_until=None)
        )
        db.commit()
        event_id_with_most = first_event.id
        await broadcaster.publish({'type': 'spike_reset', 'event_id': first_event.id})

    event = db.get(Event, event_id_with_most)
    seats = list(db.scalars(select(Seat).where(Seat.event_id == event.id, Seat.status == SeatStatus.available).order_by(Seat.seat_number.asc())))
    if not seats:
        raise HTTPException(status_code=400, detail='No available seats. Call with ?reset=true to reset seat statuses.')

    total_fake_users = min(len(seats) + 20, 60)  # slightly more users than seats
    seat_pool = [s.seat_number for s in seats]

    await broadcaster.publish({'type': 'spike_start', 'users': total_fake_users, 'seats': len(seat_pool), 'event_id': event.id})

    async def run_spike():
        tasks = []
        for i in range(total_fake_users):
            suffix = ''.join(random.choices(string.ascii_lowercase + string.digits, k=6))
            email = f'spike-{suffix}@demo.com'
            seat = seat_pool[i % len(seat_pool)]
            tasks.append(_fake_booking(db_factory=lambda: SessionLocal(), services=services, email=email, event_id=event.id, seat=seat, user_index=i))
        await asyncio.gather(*tasks)
        await broadcaster.publish({'type': 'spike_done', 'total': total_fake_users})

    asyncio.create_task(run_spike())
    return {'status': 'spike_launched', 'users': total_fake_users, 'event_id': event.id}


async def _fake_booking(db_factory, services, email: str, event_id: int, seat: str, user_index: int):
    from app.core.security import hash_password
    db = db_factory()
    try:
        # Register or reuse user
        user = db.scalar(select(User).where(User.email == email))
        if not user:
            user = User(email=email, password_hash=hash_password('spike123'), role=UserRole.user)
            db.add(user)
            db.commit()
            db.refresh(user)

        await services.broadcaster.publish({'type': 'user_queued', 'user': email, 'seat': seat, 'position': user_index + 1})
        await asyncio.sleep(random.uniform(0, 0.4))  # stagger arrivals

        idem_key = f'spike-{user.id}-{seat}-{event_id}'
        request = await services.bookings.enqueue(
            db,
            user_id=user.id,
            event_id=event_id,
            seat_numbers=[seat],
            idempotency_key=idem_key,
            payment_method='demo',
        )
        await services.broadcaster.publish({'type': 'seat_attempt', 'user': email, 'seat': seat, 'request_id': request.id, 'status': request.status.value})
    except Exception as exc:
        await services.broadcaster.publish({'type': 'spike_error', 'user': email, 'seat': seat, 'error': str(exc)})
    finally:
        db.close()


def build_app() -> FastAPI:
    app = FastAPI(title=settings.app_name, docs_url='/docs' if settings.docs_enabled else None, redoc_url=None)
    app.add_middleware(CORSMiddleware, allow_origins=['*'], allow_methods=['*'], allow_headers=['*'])
    Base.metadata.create_all(bind=engine)

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

    app.state.services = SimpleNamespace(
        auth=auth,
        events=events,
        bookings=bookings,
        payment=payment,
        notifications=notifications,
        metrics=metrics,
        queue=queue,
        locks=locks,
        broadcaster=broadcaster,
    )
    app.state.worker = worker

    @app.on_event('startup')
    async def startup() -> None:
        app.state.worker_task = asyncio.create_task(worker.run(lambda: SessionLocal()))

    @app.on_event('shutdown')
    async def shutdown() -> None:
        worker.stop()
        task = getattr(app.state, 'worker_task', None)
        if task:
            task.cancel()

    app.include_router(auth_router)
    app.include_router(events_router)
    app.include_router(bookings_router)
    app.include_router(admin_router)
    app.include_router(health_router)
    app.include_router(metrics_router)
    app.include_router(ws_router)
    app.include_router(spike_router)
    return app
