"""TMDb response cache: JSON payloads keyed by a caller-chosen string, with
a per-call TTL and a small probabilistic purge of very old rows.

Reads go through two layers before touching SQLite: an in-process LRU
(_MemCache below), then the read-only connection (read_conn(), see
connection.py) so they never queue up behind a write on the main
connection's lock. Posters/TMDb info "don't go stale in any meaningful
sense" (see posters.py) — the TTLs here are generous (measured in
days) — so a bounded in-memory cache with no active invalidation beyond
"write updates it too" is a safe trade: worst case a process serving a
title's *very first* write only sees the fresh value after a restart, on
another process, which self-heals via schedule_poster_backfill() anyway.
"""
from __future__ import annotations

import json
import logging
import random
import time
from collections import OrderedDict
from typing import Any

from .connection import conn, read_conn, retry_on_lock

logger = logging.getLogger(__name__)

_CACHE_PURGE_PROBABILITY = 0.05
_CACHE_PURGE_MAX_AGE = 30 * 24 * 3600  # 30 days safety net

_MEM_CACHE_MAX_ENTRIES = 4096


class _MemCache:
    """Tiny process-local LRU in front of the tmdb_cache table. Stores
    (payload, cached_at) pairs so callers can still apply their own TTL —
    the in-memory copy never goes stale on its own, it just mirrors
    whatever's in SQLite at the time it was last read or written."""

    def __init__(self, max_entries: int = _MEM_CACHE_MAX_ENTRIES) -> None:
        self._data: OrderedDict[str, tuple[Any, float]] = OrderedDict()
        self._max_entries = max_entries

    def get(self, key: str) -> tuple[Any, float] | None:
        entry = self._data.get(key)
        if entry is not None:
            self._data.move_to_end(key)
        return entry

    def set(self, key: str, payload: Any, cached_at: float) -> None:
        self._data[key] = (payload, cached_at)
        self._data.move_to_end(key)
        while len(self._data) > self._max_entries:
            self._data.popitem(last=False)

    def discard(self, key: str) -> None:
        self._data.pop(key, None)


_mem_cache = _MemCache()


def clear_mem_cache() -> None:
    """Drop the in-process LRU entirely. Call this whenever the underlying
    SQLite file is swapped out from under the process (tests pointing
    settings.DB_PATH at a fresh temp file between cases) — otherwise a
    cache_key that happens to repeat across tests (e.g. the same movie
    title) would silently serve a previous test's DB row instead of the
    new one, or a stale hit either way."""
    _mem_cache._data.clear()


async def get_tmdb_cache(key: str, ttl_seconds: int) -> Any | None:
    """Return a cached value if present and not older than ttl_seconds, else None."""
    hit = _mem_cache.get(key)
    if hit is not None:
        payload, cached_at = hit
        return payload if time.time() - cached_at <= ttl_seconds else None

    async with read_conn() as db:
        async with db.execute(
            "SELECT payload, cached_at FROM tmdb_cache WHERE cache_key = ?", (key,)
        ) as cur:
            row = await cur.fetchone()
    if not row:
        return None
    raw_payload, cached_at = row[0], row[1]
    try:
        payload = json.loads(raw_payload)
    except (TypeError, ValueError):
        logger.warning("tmdb_cache: corrupted payload for key %r, ignoring", key)
        return None
    _mem_cache.set(key, payload, cached_at)
    return payload if time.time() - cached_at <= ttl_seconds else None


async def get_tmdb_cache_many(keys: list[str], ttl_seconds: int) -> dict[str, Any]:
    """Batched counterpart of get_tmdb_cache(): one SELECT ... WHERE cache_key
    IN (...) for whatever the in-process cache doesn't already have, instead
    of N round trips each of which used to serialize on the shared
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
    now = time.time()
    out: dict[str, Any] = {}
    missing: list[str] = []
    for key in keys:
        hit = _mem_cache.get(key)
        if hit is None:
            missing.append(key)
            continue
        payload, cached_at = hit
        if now - cached_at <= ttl_seconds:
            out[key] = payload

    if missing:
        async with read_conn() as db:
            # SQLite's default limit on bound parameters is 999; chunk so a
            # large batch (e.g. a franchise category with hundreds of titles,
            # queried under two key prefixes each) can't exceed it.
            CHUNK = 400
            for i in range(0, len(missing), CHUNK):
                chunk = missing[i : i + CHUNK]
                placeholders = ",".join("?" * len(chunk))
                async with db.execute(
                    f"SELECT cache_key, payload, cached_at FROM tmdb_cache WHERE cache_key IN ({placeholders})",
                    chunk,
                ) as cur:
                    rows = await cur.fetchall()
                for cache_key, raw_payload, cached_at in rows:
                    try:
                        payload = json.loads(raw_payload)
                    except (TypeError, ValueError):
                        logger.warning("tmdb_cache: corrupted payload for key %r, ignoring", cache_key)
                        continue
                    _mem_cache.set(cache_key, payload, cached_at)
                    if now - cached_at <= ttl_seconds:
                        out[cache_key] = payload
    return out


@retry_on_lock
async def set_tmdb_cache(key: str, value: Any) -> None:
    cached_at = time.time()
    payload = json.dumps(value, ensure_ascii=False)
    async with conn() as db:
        await db.execute(
            "INSERT INTO tmdb_cache (cache_key, payload, cached_at) VALUES (?, ?, ?) "
            "ON CONFLICT(cache_key) DO UPDATE SET payload = excluded.payload, cached_at = excluded.cached_at",
            (key, payload, cached_at),
        )
        if random.random() < _CACHE_PURGE_PROBABILITY:
            cutoff = cached_at - _CACHE_PURGE_MAX_AGE
            await db.execute("DELETE FROM tmdb_cache WHERE cached_at < ?", (cutoff,))
        await db.commit()
    # Keep the in-process mirror in sync so a reader in this same process
    # sees the fresh value immediately instead of whatever was cached (or
    # not) before this write, until it naturally ages out of the LRU.
    _mem_cache.set(key, value, cached_at)
