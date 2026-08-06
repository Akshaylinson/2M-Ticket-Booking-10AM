from __future__ import annotations

import asyncio
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, AsyncIterator


class Metrics:
    def __init__(self) -> None:
        self._counters: dict[str, int] = defaultdict(int)
        self._gauges: dict[str, float] = defaultdict(float)

    def inc(self, name: str, amount: int = 1) -> None:
        self._counters[name] += amount

    def set(self, name: str, value: float) -> None:
        self._gauges[name] = value

    def snapshot(self) -> dict[str, int | float]:
        return {**self._counters, **self._gauges}

    def to_prometheus(self) -> str:
        lines: list[str] = []
        for key, value in sorted(self._counters.items()):
            lines.append(f"# TYPE {key} counter")
            lines.append(f"{key} {value}")
        for key, value in sorted(self._gauges.items()):
            lines.append(f"# TYPE {key} gauge")
            lines.append(f"{key} {value}")
        return "\n".join(lines) + "\n"


@dataclass
class LockRecord:
    owner: str
    expires_at: datetime


class SeatLockManager:
    def __init__(self) -> None:
        self._locks: dict[str, LockRecord] = {}
        self._mutex = asyncio.Lock()

    async def acquire(self, key: str, owner: str, ttl_seconds: int = 120) -> bool:
        now = datetime.now(timezone.utc)
        async with self._mutex:
            record = self._locks.get(key)
            if record is None or record.expires_at <= now:
                self._locks[key] = LockRecord(owner=owner, expires_at=now + timedelta(seconds=ttl_seconds))
                return True
            return False

    async def release(self, key: str, owner: str) -> None:
        async with self._mutex:
            record = self._locks.get(key)
            if record and record.owner == owner:
                self._locks.pop(key, None)

    async def locked_keys(self) -> list[str]:
        async with self._mutex:
            return list(self._locks)


class EventBroadcaster:
    def __init__(self) -> None:
        self._subscribers: set[asyncio.Queue[dict[str, Any]]] = set()
        self._mutex = asyncio.Lock()

    async def publish(self, event: dict[str, Any]) -> None:
        async with self._mutex:
            subscribers = list(self._subscribers)
        for queue in subscribers:
            await queue.put(event)

    async def subscribe(self) -> AsyncIterator[dict[str, Any]]:
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        async with self._mutex:
            self._subscribers.add(queue)
        try:
            while True:
                yield await queue.get()
        finally:
            async with self._mutex:
                self._subscribers.discard(queue)


class BookingQueue:
    def __init__(self) -> None:
        self._queue: asyncio.Queue[int] = asyncio.Queue()

    async def enqueue(self, request_id: int) -> int:
        await self._queue.put(request_id)
        return self._queue.qsize()

    async def get(self) -> int:
        return await self._queue.get()

    def size(self) -> int:
        return self._queue.qsize()

