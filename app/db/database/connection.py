"""Shared SQLite connection helper, the lock-retry decorator, and the table
allowlist used to build safe dynamic SQL elsewhere in this package."""
from __future__ import annotations

import asyncio
import functools
import logging
import random
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator, Callable, TypeVar

import aiosqlite

from app.config import settings

logger = logging.getLogger(__name__)

ALLOWED_TABLES = frozenset({"movies", "cartoons", "series", "dc", "marvel", "upcoming_movies", "tracked_series"})
NOCASE_TABLES = ("movies", "cartoons", "series", "dc", "marvel", "upcoming_movies", "tracked_series")

_DB_MAX_RETRIES = 4
_DB_RETRY_BASE = 0.15  # seconds

_F = TypeVar("_F", bound=Callable[..., Any])


def retry_on_lock(func: _F) -> _F:
    @functools.wraps(func)
    async def wrapper(*args: Any, **kwargs: Any) -> Any:
        for attempt in range(1, _DB_MAX_RETRIES + 1):
            try:
                return await func(*args, **kwargs)
            except aiosqlite.OperationalError as e:
                if "locked" not in str(e).lower() or attempt == _DB_MAX_RETRIES:
                    raise
                delay = _DB_RETRY_BASE * (2 ** (attempt - 1)) + random.uniform(0, 0.05)
                logger.warning(
                    "DB locked in %s (attempt %d/%d), retrying in %.2fs",
                    func.__name__, attempt, _DB_MAX_RETRIES, delay,
                )
                await asyncio.sleep(delay)
    return wrapper  # type: ignore[return-value]


@asynccontextmanager
async def conn() -> AsyncIterator[aiosqlite.Connection]:
    async with aiosqlite.connect(settings.DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        await db.execute("PRAGMA journal_mode=WAL")
        await db.execute("PRAGMA busy_timeout=5000")
        yield db


def check_table(name: str) -> None:
    if name not in ALLOWED_TABLES:
        raise ValueError(f"Unknown table: {name!r}")
