"""Async SQLite layer using aiosqlite."""
from __future__ import annotations

import asyncio
import functools
import json
import logging
import random
import time
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator, Callable, TypeVar

import aiosqlite

from app.config import settings

logger = logging.getLogger(__name__)

ALLOWED_TABLES = frozenset({"movies", "cartoons", "series", "dc", "marvel", "upcoming_movies", "tracked_series"})
_NOCASE_TABLES = ("movies", "cartoons", "series", "dc", "marvel", "upcoming_movies", "tracked_series")

_CACHE_PURGE_PROBABILITY = 0.05
_CACHE_PURGE_MAX_AGE = 30 * 24 * 3600  # 30 days safety net

_DB_MAX_RETRIES = 4
_DB_RETRY_BASE = 0.15  # seconds

_F = TypeVar("_F", bound=Callable[..., Any])


def _retry_on_lock(func: _F) -> _F:
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
async def _conn() -> AsyncIterator[aiosqlite.Connection]:
    async with aiosqlite.connect(settings.DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        yield db


async def _migrate_to_nocase(db: aiosqlite.Connection, table: str) -> None:
    """If `table` exists but its `title` column isn't COLLATE NOCASE, rebuild it
    with the new schema, migrating data and merging case-insensitive duplicates
    (first occurrence wins, rest are dropped silently)."""
    async with db.execute(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?", (table,)
    ) as cur:
        row = await cur.fetchone()

    if row is None:
        return

    create_sql = row[0] or ""
    if "COLLATE NOCASE" in create_sql.upper().replace("COLLATE  NOCASE", "COLLATE NOCASE"):
        return

    logger.info("Migration: rebuilding table %r with COLLATE NOCASE on title…", table)

    tmp_table = f"{table}__new_nocase"
    await db.execute(f"DROP TABLE IF EXISTS {tmp_table}")
    await db.execute(
        f"CREATE TABLE {tmp_table} "
        f"(id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT UNIQUE NOT NULL COLLATE NOCASE)"
    )

    async with db.execute(f"SELECT title FROM {table} ORDER BY id ASC") as cur:
        titles = [r[0] async for r in cur]

    dropped: list[str] = []
    for title in titles:
        result = await db.execute(
            f"INSERT OR IGNORE INTO {tmp_table} (title) VALUES (?)", (title,)
        )
        if result.rowcount == 0:
            dropped.append(title)

    await db.execute(f"DROP TABLE {table}")
    await db.execute(f"ALTER TABLE {tmp_table} RENAME TO {table}")

    if dropped:
        logger.warning(
            "Migration: table %r had %d case-insensitive duplicate(s) merged away: %s",
            table, len(dropped), dropped,
        )
    logger.info("Migration: table %r rebuilt (%d rows kept).", table, len(titles) - len(dropped))


async def init_db() -> None:
    """Create tables and run migrations."""
    async with _conn() as db:
        async with db.execute("PRAGMA table_info(history)") as cur:
            cols = {row[1] async for row in cur}
        if cols and "user_id" not in cols:
            logger.info("Migration: adding user_id to history…")
            await db.execute(
                "ALTER TABLE history ADD COLUMN user_id INTEGER NOT NULL DEFAULT 0"
            )
        await db.commit()

        for table in _NOCASE_TABLES:
            await _migrate_to_nocase(db, table)
        await db.commit()

        await db.executescript(
            """
            CREATE TABLE IF NOT EXISTS history (
                id        INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id   INTEGER NOT NULL DEFAULT 0,
                category  TEXT    NOT NULL,
                title     TEXT    NOT NULL,
                timestamp REAL    NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_history_user_category_ts
                ON history (user_id, category, timestamp);

            CREATE TABLE IF NOT EXISTS movies        (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT UNIQUE NOT NULL COLLATE NOCASE);
            CREATE TABLE IF NOT EXISTS cartoons      (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT UNIQUE NOT NULL COLLATE NOCASE);
            CREATE TABLE IF NOT EXISTS series        (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT UNIQUE NOT NULL COLLATE NOCASE);
            CREATE TABLE IF NOT EXISTS dc            (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT UNIQUE NOT NULL COLLATE NOCASE);
            CREATE TABLE IF NOT EXISTS marvel        (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT UNIQUE NOT NULL COLLATE NOCASE);
            CREATE TABLE IF NOT EXISTS upcoming_movies (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT UNIQUE NOT NULL COLLATE NOCASE);
            CREATE TABLE IF NOT EXISTS tracked_series  (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT UNIQUE NOT NULL COLLATE NOCASE);

            CREATE TABLE IF NOT EXISTS tmdb_cache (
                cache_key TEXT PRIMARY KEY,
                payload   TEXT NOT NULL,
                cached_at REAL NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_tmdb_cache_cached_at ON tmdb_cache (cached_at);

            CREATE TABLE IF NOT EXISTS skipped_titles (
                scope TEXT NOT NULL,
                title TEXT NOT NULL COLLATE NOCASE,
                PRIMARY KEY (scope, title)
            );
            """
        )
        await db.commit()
    logger.info("DB initialised.")


# ─── Generic helpers ───────────────────────────────────────────────────────────
def _check_table(name: str) -> None:
    if name not in ALLOWED_TABLES:
        raise ValueError(f"Unknown table: {name!r}")


async def get_items(table: str) -> list[str]:
    _check_table(table)
    async with _conn() as db:
        async with db.execute(f"SELECT title FROM {table}") as cur:
            return [row[0] async for row in cur]


async def item_exists(table: str, title: str) -> bool:
    """Case-insensitive existence check (relies on COLLATE NOCASE on the column)."""
    _check_table(table)
    async with _conn() as db:
        async with db.execute(f"SELECT 1 FROM {table} WHERE title = ? LIMIT 1", (title,)) as cur:
            return await cur.fetchone() is not None


@_retry_on_lock
async def add_item(table: str, title: str) -> None:
    _check_table(table)
    title = title.strip()
    if not title:
        raise ValueError("Title cannot be empty.")
    async with _conn() as db:
        await db.execute(f"INSERT OR IGNORE INTO {table} (title) VALUES (?)", (title,))
        await db.commit()


@_retry_on_lock
async def delete_item(table: str, title: str) -> None:
    _check_table(table)
    async with _conn() as db:
        await db.execute(f"DELETE FROM {table} WHERE title = ?", (title,))
        await db.commit()


# ─── TMDb response cache ────────────────────────────────────────────────────────
async def get_tmdb_cache(key: str, ttl_seconds: int) -> Any | None:
    """Return a cached value if present and not older than ttl_seconds, else None."""
    async with _conn() as db:
        async with db.execute(
            "SELECT payload, cached_at FROM tmdb_cache WHERE cache_key = ?", (key,)
        ) as cur:
            row = await cur.fetchone()
    if not row:
        return None
    payload, cached_at = row[0], row[1]
    if time.time() - cached_at > ttl_seconds:
        return None
    try:
        return json.loads(payload)
    except (TypeError, ValueError):
        logger.warning("tmdb_cache: corrupted payload for key %r, ignoring", key)
        return None


@_retry_on_lock
async def set_tmdb_cache(key: str, value: Any) -> None:
    payload = json.dumps(value, ensure_ascii=False)
    async with _conn() as db:
        await db.execute(
            "INSERT INTO tmdb_cache (cache_key, payload, cached_at) VALUES (?, ?, ?) "
            "ON CONFLICT(cache_key) DO UPDATE SET payload = excluded.payload, cached_at = excluded.cached_at",
            (key, payload, time.time()),
        )
        if random.random() < _CACHE_PURGE_PROBABILITY:
            cutoff = time.time() - _CACHE_PURGE_MAX_AGE
            await db.execute("DELETE FROM tmdb_cache WHERE cached_at < ?", (cutoff,))
        await db.commit()


# ─── History ───────────────────────────────────────────────────────────────────
async def load_history(user_id: int, category: str | None = None) -> list[dict[str, Any]]:
    query = (
        "SELECT category, title, timestamp FROM history "
        "WHERE user_id = ? AND category = ? ORDER BY timestamp DESC"
        if category
        else "SELECT category, title, timestamp FROM history "
             "WHERE user_id = ? ORDER BY timestamp DESC"
    )
    params: tuple[Any, ...] = (user_id, category) if category else (user_id,)
    async with _conn() as db:
        async with db.execute(query, params) as cur:
            return [
                {"category": row[0], "title": row[1], "timestamp": row[2]}
                async for row in cur
            ]


async def get_recent_history(limit: int = 50) -> list[dict[str, Any]]:
    """History across ALL users (no user_id filter) — used by the web UI,
    which has no login/user concept by design (personal-use, no-auth site).
    Newest first."""
    async with _conn() as db:
        async with db.execute(
            "SELECT category, title, timestamp FROM history ORDER BY timestamp DESC LIMIT ?",
            (limit,),
        ) as cur:
            return [
                {"category": row[0], "title": row[1], "timestamp": row[2]}
                async for row in cur
            ]


@_retry_on_lock
async def save_history(user_id: int, category: str, title: str) -> float:
    film_cats = ("movies", "cartoons")
    limit = settings.HISTORY_CLEAR_LIMIT

    async with _conn() as db:
        if category in film_cats:
            async with db.execute(
                "SELECT COUNT(*) FROM history WHERE user_id = ? AND category IN (?,?)",
                (user_id, *film_cats),
            ) as cur:
                row = await cur.fetchone()
                count = row[0] if row else 0
        else:
            async with db.execute(
                "SELECT COUNT(*) FROM history WHERE user_id = ? AND category = ?",
                (user_id, category),
            ) as cur:
                row = await cur.fetchone()
                count = row[0] if row else 0

        if count >= limit:
            excess = count - limit + 1
            if category in film_cats:
                await db.execute(
                    "DELETE FROM history WHERE id IN ("
                    "  SELECT id FROM history WHERE user_id = ? AND category IN (?,?)"
                    "  ORDER BY timestamp ASC LIMIT ?"
                    ")",
                    (user_id, *film_cats, excess),
                )
            else:
                await db.execute(
                    "DELETE FROM history WHERE id IN ("
                    "  SELECT id FROM history WHERE user_id = ? AND category = ?"
                    "  ORDER BY timestamp ASC LIMIT ?"
                    ")",
                    (user_id, category, excess),
                )

        ts = time.time()
        await db.execute(
            "INSERT INTO history (user_id, category, title, timestamp) VALUES (?,?,?,?)",
            (user_id, category, title, ts),
        )
        await db.commit()
        return ts


@_retry_on_lock
async def clear_user_history(user_id: int) -> None:
    async with _conn() as db:
        await db.execute("DELETE FROM history WHERE user_id = ?", (user_id,))
        await db.commit()


@_retry_on_lock
async def clear_all_history() -> None:
    async with _conn() as db:
        await db.execute("DELETE FROM history")
        await db.commit()


@_retry_on_lock
async def clear_history_category(category: str) -> None:
    async with _conn() as db:
        await db.execute("DELETE FROM history WHERE category = ?", (category,))
        await db.commit()


async def get_stats(user_id: int) -> dict[str, int]:
    cats = ("movies", "cartoons", "series")
    result = {c: 0 for c in cats}
    async with _conn() as db:
        async with db.execute(
            "SELECT category, COUNT(*) FROM history "
            "WHERE user_id = ? AND category IN (?,?,?) GROUP BY category",
            (user_id, *cats),
        ) as cur:
            async for cat, cnt in cur:
                result[cat] = cnt
    return result


# ─── Upcoming movies ───────────────────────────────────────────────────────────
async def get_upcoming_movies() -> list[str]:
    return await get_items("upcoming_movies")


async def add_upcoming_movie(title: str) -> None:
    await add_item("upcoming_movies", title)


async def delete_upcoming_movie(title: str) -> None:
    await delete_item("upcoming_movies", title)


# ─── Skipped titles ─────────────────────────────────────────────────────────────
SKIP_SCOPES = frozenset({"theaters_now_playing", "theaters_upcoming", "series_releases"})


def _check_skip_scope(scope: str) -> None:
    if scope not in SKIP_SCOPES:
        raise ValueError(f"Unknown skip scope: {scope!r}")


@_retry_on_lock
async def get_skipped(scope: str) -> list[str]:
    _check_skip_scope(scope)
    async with _conn() as db:
        async with db.execute(
            "SELECT title FROM skipped_titles WHERE scope = ?", (scope,)
        ) as cur:
            return [row[0] async for row in cur]


@_retry_on_lock
async def add_skipped(scope: str, title: str) -> None:
    _check_skip_scope(scope)
    async with _conn() as db:
        await db.execute(
            "INSERT OR IGNORE INTO skipped_titles (scope, title) VALUES (?, ?)",
            (scope, title),
        )
        await db.commit()


@_retry_on_lock
async def remove_skipped(scope: str, title: str) -> None:
    _check_skip_scope(scope)
    async with _conn() as db:
        await db.execute(
            "DELETE FROM skipped_titles WHERE scope = ? AND title = ? COLLATE NOCASE",
            (scope, title),
        )
        await db.commit()
