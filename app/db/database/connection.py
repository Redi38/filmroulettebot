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

# Every title-list table. One source of truth for both jobs below, so a new
# list table can't end up allowed in dynamic SQL but missing its case-insensitive
# unique index (or the other way round).
LIST_TABLES = ("movies", "cartoons", "series", "dc", "marvel", "upcoming_movies", "tracked_series")
ALLOWED_TABLES = frozenset(LIST_TABLES)  # check_table(): allowlist for dynamic SQL
NOCASE_TABLES = LIST_TABLES  # schema.py: tables whose title column uses UNICODE_NOCASE


def _unicode_nocase(a: str, b: str) -> int:
    a, b = a.casefold(), b.casefold()
    return -1 if a < b else (1 if a > b else 0)


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


_db_conn: aiosqlite.Connection | None = None
_db_conn_lock = asyncio.Lock()

_read_db_conn: aiosqlite.Connection | None = None
_read_db_conn_lock = asyncio.Lock()


async def _register_collation(db: aiosqlite.Connection) -> None:
    """Register UNICODE_NOCASE on `db`. SQLite's built-in NOCASE only folds
    ASCII, so Cyrillic titles need our own casefold()-based collation.

    aiosqlite (through 0.22) has no public create_collation(), so this reaches
    for two private attributes: the wrapped sqlite3 connection (`_conn`) and
    the helper that runs a call on its worker thread (`_execute`). This is the
    only place that does, so a future aiosqlite upgrade breaks here — loudly,
    with the message below — and tests/test_db_collation.py pins the behaviour."""
    try:
        await db._execute(db._conn.create_collation, "UNICODE_NOCASE", _unicode_nocase)
    except AttributeError as e:  # pragma: no cover - only on an incompatible aiosqlite
        raise RuntimeError(
            "aiosqlite no longer exposes the private hooks needed to register the "
            "UNICODE_NOCASE collation; update _register_collation() in "
            "app/db/database/connection.py"
        ) from e


async def _open_connection() -> aiosqlite.Connection:
    db = await aiosqlite.connect(settings.DB_PATH)
    db.row_factory = aiosqlite.Row
    await _register_collation(db)
    await db.execute("PRAGMA journal_mode=WAL")
    await db.execute("PRAGMA busy_timeout=5000")
    return db


async def _get_connection() -> aiosqlite.Connection:
    global _db_conn
    if _db_conn is None:
        _db_conn = await _open_connection()
    return _db_conn


async def _get_read_connection() -> aiosqlite.Connection:
    """A second connection to the same WAL-mode database, used for
    read-only queries (see read_conn() below). WAL lets any number of
    readers run concurrently with the single writer without blocking each
    other — but that only helps if reads and writes actually use separate
    connections; sharing one connection (and one asyncio.Lock, as conn()
    does) serializes everything in this process regardless of what SQLite
    itself would allow. Splitting reads onto their own connection means a
    page of poster lookups no longer queues up behind an in-flight
    add/delete/rename, and vice versa."""
    global _read_db_conn
    if _read_db_conn is None:
        _read_db_conn = await _open_connection()
        await _read_db_conn.execute("PRAGMA query_only = TRUE")
    return _read_db_conn


@asynccontextmanager
async def conn() -> AsyncIterator[aiosqlite.Connection]:
    async with _db_conn_lock:
        db = await _get_connection()
        yield db


@asynccontextmanager
async def read_conn() -> AsyncIterator[aiosqlite.Connection]:
    """Like conn(), but for read-only queries: uses the second, query_only
    connection so reads don't serialize behind writes on the main
    connection's lock. Never write through this — PRAGMA query_only makes
    SQLite reject it, but callers still shouldn't reach for this on a
    write path."""
    async with _read_db_conn_lock:
        db = await _get_read_connection()
        yield db


async def close_db() -> None:
    """Close the shared connections. Call once on process shutdown.

    Also replaces the two locks. An asyncio.Lock binds itself to whichever
    event loop first has to *wait* on it and then refuses every other loop
    ("is bound to a different event loop"). In production there is one loop
    for the process's lifetime so that never matters, but a lock that keeps
    its old loop (or was left locked by a task that died with it) across a
    close/reopen would poison the next loop — the tests' per-test TestClient
    loops are the case that hit this. A fresh lock per open cycle is free.
    """
    global _db_conn, _read_db_conn, _db_conn_lock, _read_db_conn_lock
    if _db_conn is not None:
        await _db_conn.close()
        _db_conn = None
    if _read_db_conn is not None:
        await _read_db_conn.close()
        _read_db_conn = None
    _db_conn_lock = asyncio.Lock()
    _read_db_conn_lock = asyncio.Lock()


def check_table(name: str) -> None:
    if name not in ALLOWED_TABLES:
        raise ValueError(f"Unknown table: {name!r}")
