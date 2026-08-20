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
