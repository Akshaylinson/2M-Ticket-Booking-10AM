from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core.config import get_settings
from app.core.security import create_token, hash_password, verify_password
from app.infra import BookingQueue, EventBroadcaster, Metrics, SeatLockManager
from app.models import (
    AuditLog,
    Booking,
    BookingRequest,
    BookingStatus,
    BookingSeat,
    Event,
    Notification,
    NotificationType,
    Payment,
    PaymentStatus,
    Seat,
    SeatStatus,
    User,
    UserRole,
)


settings = get_settings()


class AuthService:
    def register(self, db: Session, email: str, password: str, role: UserRole = UserRole.user) -> User:
        existing = db.scalar(select(User).where(User.email == email.lower()))
        if existing:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail='Email already registered')
        user = User(email=email.lower(), password_hash=hash_password(password), role=role)
        db.add(user)
        db.commit()
        db.refresh(user)
        return user

    def login(self, db: Session, email: str, password: str) -> str:
        user = db.scalar(select(User).where(User.email == email.lower()))
        if not user or not verify_password(password, user.password_hash):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='Invalid credentials')
        payload = {
            'sub': str(user.id),
            'email': user.email,
            'role': user.role.value,
            'exp': int((datetime.now(timezone.utc) + timedelta(minutes=settings.access_token_minutes)).timestamp()),
        }
        return create_token(payload, settings.secret_key)


class EventService:
    def create_event(
        self,
        db: Session,
        *,
        creator_id: int | None,
        title: str,
        description: str,
        venue: str,
        starts_at: datetime,
        seat_numbers: list[str],
        price_per_seat: float,
    ) -> Event:
        if not seat_numbers:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='At least one seat is required')
        event = Event(
            title=title,
            description=description,
            venue=venue,
            starts_at=starts_at,
            total_seats=len(seat_numbers),
            created_by=creator_id,
        )
        db.add(event)
        db.flush()
        for seat_number in seat_numbers:
            db.add(Seat(event_id=event.id, seat_number=seat_number, status=SeatStatus.available))
        db.add(AuditLog(actor_id=creator_id, action='create_event', entity_type='event', entity_id=str(event.id), payload={'title': title}))
        db.commit()
        db.refresh(event)
        return event

    def list_events(self, db: Session) -> list[Event]:
        return list(db.scalars(select(Event).order_by(Event.starts_at.desc())))

    def get_event(self, db: Session, event_id: int) -> Event:
        event = db.scalar(select(Event).where(Event.id == event_id).options(selectinload(Event.seats)))
        if not event:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Event not found')
        return event

    def list_seats(self, db: Session, event_id: int) -> list[Seat]:
        return list(db.scalars(select(Seat).where(Seat.event_id == event_id).order_by(Seat.seat_number.asc())))


class PaymentService:
    def charge(self, booking: Booking, payment_method: str, *, force_failure: bool = False) -> tuple[PaymentStatus, str | None, str | None]:
        if force_failure:
            return PaymentStatus.failed, None, 'Simulated payment failure'
        transaction_ref = f'demo_{booking.booking_ref}'
        return PaymentStatus.succeeded, transaction_ref, None


class NotificationService:
    def __init__(self, broadcaster: EventBroadcaster, metrics: Metrics) -> None:
        self._broadcaster = broadcaster
        self._metrics = metrics

    def create_notification(self, db: Session, user_id: int, notif_type: NotificationType, payload: dict) -> Notification:
        notif = Notification(user_id=user_id, type=notif_type, payload=payload)
        db.add(notif)
        db.commit()
        db.refresh(notif)
        return notif

    async def publish(self, event_type: str, payload: dict) -> None:
        self._metrics.inc(f'notifications_{event_type}')
        await self._broadcaster.publish({'type': event_type, 'payload': payload})


class BookingService:
    def __init__(
        self,
        queue: BookingQueue,
        locks: SeatLockManager,
        broadcaster: EventBroadcaster,
        metrics: Metrics,
        payment_service: PaymentService,
        notification_service: NotificationService,
    ) -> None:
        self.queue = queue
        self.locks = locks
        self.broadcaster = broadcaster
        self.metrics = metrics
        self.payment_service = payment_service
        self.notification_service = notification_service

    def submit_request(
        self,
        db: Session,
        *,
        user_id: int,
        event_id: int,
        seat_numbers: list[str],
        idempotency_key: str,
        payment_method: str,
    ) -> BookingRequest:
        existing = db.scalar(select(BookingRequest).where(BookingRequest.user_id == user_id, BookingRequest.idempotency_key == idempotency_key))
        if existing:
            self.metrics.inc('duplicate_booking_attempts')
            return existing
        request = BookingRequest(
            user_id=user_id,
            event_id=event_id,
            idempotency_key=idempotency_key,
            seat_numbers_json=seat_numbers,
            payment_method=payment_method,
            status=BookingStatus.queued,
        )
        db.add(request)
        db.flush()
        request.queue_position = self.queue.size() + 1
        db.commit()
        db.refresh(request)
        return request

    async def enqueue(
        self,
        db: Session,
        *,
        user_id: int,
        event_id: int,
        seat_numbers: list[str],
        idempotency_key: str,
        payment_method: str,
    ) -> BookingRequest:
        request = self.submit_request(
            db,
            user_id=user_id,
            event_id=event_id,
            seat_numbers=seat_numbers,
            idempotency_key=idempotency_key,
            payment_method=payment_method,
        )
        if request.booking_id is None and request.status == BookingStatus.queued:
            request.queue_position = await self.queue.enqueue(request.id)
            db.commit()
        return request

    async def process_request(self, db_factory, request_id: int) -> Booking | None:
        db: Session = db_factory()
        try:
            request = db.scalar(select(BookingRequest).where(BookingRequest.id == request_id))
            if not request:
                return None
            if request.status in {BookingStatus.confirmed, BookingStatus.failed, BookingStatus.cancelled}:
                return db.get(Booking, request.booking_id) if request.booking_id is not None else None

            request.status = BookingStatus.processing
            db.commit()

            owner = f'request-{request.id}'
            seat_keys = [f'seat:{request.event_id}:{seat}' for seat in sorted(request.seat_numbers_json)]
            for key in seat_keys:
                acquired = await self.locks.acquire(key, owner, ttl_seconds=settings.booking_hold_seconds)
                if not acquired:
                    request.status = BookingStatus.failed
                    request.error_message = 'Seat is currently locked'
                    db.commit()
                    return None

            try:
                booking = self._reserve_and_pay(db, request)
                if booking:
                    request.booking_id = booking.id
                    request.status = BookingStatus.confirmed
                    db.commit()
                    self.metrics.inc('bookings_confirmed')
                    await self.broadcaster.publish({'type': 'booking_confirmed', 'booking_ref': booking.booking_ref, 'request_id': request.id})
                    await self.notification_service.publish('booking_confirmed', {'booking_ref': booking.booking_ref, 'user_id': booking.user_id})
                    return booking

                request.status = BookingStatus.failed
                db.commit()
                return None
            finally:
                for key in seat_keys:
                    await self.locks.release(key, owner)
        finally:
            db.close()

    def _reserve_and_pay(self, db: Session, request: BookingRequest) -> Booking | None:
        event = db.scalar(select(Event).where(Event.id == request.event_id))
        if not event:
            request.status = BookingStatus.failed
            request.error_message = 'Event not found'
            db.commit()
            return None

        seats = list(
            db.scalars(
                select(Seat)
                .where(Seat.event_id == request.event_id, Seat.seat_number.in_(request.seat_numbers_json))
                .with_for_update()
            )
        )
        if len(seats) != len(request.seat_numbers_json):
            request.status = BookingStatus.failed
            request.error_message = 'One or more seats do not exist'
            db.commit()
            return None

        now = datetime.now(timezone.utc)
        for seat in seats:
            if seat.status == SeatStatus.booked:
                request.status = BookingStatus.failed
                request.error_message = f'Seat {seat.seat_number} already booked'
                db.commit()
                return None
            if seat.status == SeatStatus.reserved and seat.reserved_until and seat.reserved_until > now and seat.reserved_by_user_id != request.user_id:
                request.status = BookingStatus.failed
                request.error_message = f'Seat {seat.seat_number} temporarily reserved'
                db.commit()
                return None

        booking_ref = uuid.uuid4().hex[:12].upper()
        booking = Booking(
            booking_ref=booking_ref,
            user_id=request.user_id,
            event_id=request.event_id,
            idempotency_key=request.idempotency_key,
            status=BookingStatus.processing,
        )
        db.add(booking)
        db.flush()

        total_amount = 0.0
        payment = Payment(booking_id=booking.id, provider=request.payment_method, status=PaymentStatus.pending, amount=0.0)
        db.add(payment)
        booking.payment = payment

        for seat in seats:
            seat.status = SeatStatus.reserved
            seat.reserved_by_user_id = request.user_id
            seat.reserved_until = now + timedelta(seconds=settings.booking_hold_seconds)
            seat.version += 1
            total_amount += 250.0
            db.add(BookingSeat(booking_id=booking.id, seat_id=seat.id, seat_number=seat.seat_number, price=250.0))

        booking.total_amount = total_amount
        payment.amount = total_amount
        db.commit()
        db.refresh(booking)

        force_failure = request.payment_method.lower() == 'fail'
        payment_status, txn_ref, error = self.payment_service.charge(booking, request.payment_method, force_failure=force_failure)
        payment.status = payment_status
        payment.transaction_ref = txn_ref
        payment.error_message = error

        if payment_status == PaymentStatus.failed:
            for seat in seats:
                seat.status = SeatStatus.available
                seat.reserved_by_user_id = None
                seat.reserved_until = None
                seat.version += 1
            booking.status = BookingStatus.failed
            booking.cancelled_at = datetime.now(timezone.utc)
            request.error_message = error or 'Payment failed'
            request.status = BookingStatus.failed
            db.commit()
            self.metrics.inc('bookings_failed')
            return None

        for seat in seats:
            seat.status = SeatStatus.booked
            seat.reserved_until = None
            seat.version += 1
        booking.status = BookingStatus.confirmed
        booking.confirmed_at = datetime.now(timezone.utc)
        request.status = BookingStatus.confirmed
        db.commit()
        return booking

    def cancel_booking(self, db: Session, booking_ref: str, actor_id: int | None = None) -> Booking:
        booking = db.scalar(select(Booking).where(Booking.booking_ref == booking_ref).options(selectinload(Booking.seats)))
        if not booking:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail='Booking not found')
        if booking.status == BookingStatus.cancelled:
            return booking
        seats = list(db.scalars(select(Seat).where(Seat.id.in_([seat.seat_id for seat in booking.seats])).with_for_update()))
        for seat in seats:
            seat.status = SeatStatus.available
            seat.reserved_by_user_id = None
            seat.reserved_until = None
            seat.version += 1
        booking.status = BookingStatus.cancelled
        booking.cancelled_at = datetime.now(timezone.utc)
        db.commit()
        self.metrics.inc('bookings_cancelled')
        return booking

    def release_expired_holds(self, db: Session) -> int:
        now = datetime.now(timezone.utc)
        seats = list(db.scalars(select(Seat).where(Seat.status == SeatStatus.reserved, Seat.reserved_until < now).with_for_update()))
        count = 0
        for seat in seats:
            seat.status = SeatStatus.available
            seat.reserved_by_user_id = None
            seat.reserved_until = None
            seat.version += 1
            count += 1
        if count:
            db.commit()
        return count


class WorkerService:
    def __init__(self, queue: BookingQueue, booking_service: BookingService) -> None:
        self.queue = queue
        self.booking_service = booking_service
        self.running = False

    async def run(self, db_factory) -> None:
        self.running = True
        while self.running:
            request_id = await self.queue.get()
            await self.booking_service.process_request(db_factory, request_id)

    def stop(self) -> None:
        self.running = False
