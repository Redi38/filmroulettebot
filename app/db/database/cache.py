"""TMDb response cache: JSON payloads keyed by a caller-chosen string, with
a per-call TTL and a small probabilistic purge of very old rows."""
from __future__ import annotations

import json
import logging
import random
import time
from typing import Any

from .connection import conn, retry_on_lock

logger = logging.getLogger(__name__)

_CACHE_PURGE_PROBABILITY = 0.05
_CACHE_PURGE_MAX_AGE = 30 * 24 * 3600  # 30 days safety net


async def get_tmdb_cache(key: str, ttl_seconds: int) -> Any | None:
    """Return a cached value if present and not older than ttl_seconds, else None."""
    async with conn() as db:
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


async def get_tmdb_cache_many(keys: list[str], ttl_seconds: int) -> dict[str, Any]:
    """Batched counterpart of get_tmdb_cache(): one SELECT ... WHERE cache_key
    IN (...) instead of N round trips, each of which serializes on the shared
    connection's lock (see connection.py). Callers that need many keys at
    once (poster lookups for a whole page/collection) should always prefer
    this over a loop of get_tmdb_cache() calls — with pages of 30-300 titles,
    the loop was the dominant cost of those endpoints.

    Returns only the keys that were present, unexpired, and valid JSON —
    same "or treat it as a miss" semantics as get_tmdb_cache() for anything
    else, so callers can keep doing `result.get(key)`.
    """
    if not keys:
        return {}
    out: dict[str, Any] = {}
    now = time.time()
    async with conn() as db:
        # SQLite's default limit on bound parameters is 999; chunk so a
        # large batch (e.g. a franchise category with hundreds of titles,
        # queried under two key prefixes each) can't exceed it.
        CHUNK = 400
        for i in range(0, len(keys), CHUNK):
            chunk = keys[i : i + CHUNK]
            placeholders = ",".join("?" * len(chunk))
            async with db.execute(
                f"SELECT cache_key, payload, cached_at FROM tmdb_cache WHERE cache_key IN ({placeholders})",
                chunk,
            ) as cur:
                rows = await cur.fetchall()
            for cache_key, payload, cached_at in rows:
                if now - cached_at > ttl_seconds:
                    continue
                try:
                    out[cache_key] = json.loads(payload)
                except (TypeError, ValueError):
                    logger.warning("tmdb_cache: corrupted payload for key %r, ignoring", cache_key)
    return out


@retry_on_lock
async def set_tmdb_cache(key: str, value: Any) -> None:
    payload = json.dumps(value, ensure_ascii=False)
    async with conn() as db:
        await db.execute(
            "INSERT INTO tmdb_cache (cache_key, payload, cached_at) VALUES (?, ?, ?) "
            "ON CONFLICT(cache_key) DO UPDATE SET payload = excluded.payload, cached_at = excluded.cached_at",
            (key, payload, time.time()),
        )
        if random.random() < _CACHE_PURGE_PROBABILITY:
            cutoff = time.time() - _CACHE_PURGE_MAX_AGE
            await db.execute("DELETE FROM tmdb_cache WHERE cached_at < ?", (cutoff,))
        await db.commit()
