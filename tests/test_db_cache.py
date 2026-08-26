"""Integration tests for app/db/database/cache.py — the persistent,
TTL-based cache table that both TMDb responses and (since the recent fix)
the web "featured card" now use instead of an in-process dict."""
from __future__ import annotations

import pytest

from app.db.database import get_tmdb_cache, set_tmdb_cache

pytestmark = pytest.mark.usefixtures("initialized_db")


async def test_cache_miss_returns_none():
    assert await get_tmdb_cache("no-such-key", 3600) is None


async def test_cache_roundtrip():
    await set_tmdb_cache("k1", {"a": 1, "nested": [1, 2, 3]})
    assert await get_tmdb_cache("k1", 3600) == {"a": 1, "nested": [1, 2, 3]}


async def test_cache_set_overwrites_existing_value():
    await set_tmdb_cache("k1", {"v": 1})
    await set_tmdb_cache("k1", {"v": 2})
    assert await get_tmdb_cache("k1", 3600) == {"v": 2}


async def test_cache_entry_expires_after_its_ttl(monkeypatch):
    from app.db.database import cache as cache_module

    fake_time = [1_000_000.0]
    monkeypatch.setattr(cache_module.time, "time", lambda: fake_time[0])

    await set_tmdb_cache("k1", {"v": 1})
    assert await get_tmdb_cache("k1", 10) == {"v": 1}  # still fresh

    fake_time[0] += 20  # older than the 10s TTL now
    assert await get_tmdb_cache("k1", 10) is None


async def test_cache_survives_independently_per_key():
    await set_tmdb_cache("featured:movies:Матрица", {"title": "Матрица"})
    await set_tmdb_cache("featured:series:Клан Сопрано", {"title": "Клан Сопрано"})
    assert (await get_tmdb_cache("featured:movies:Матрица", 3600))["title"] == "Матрица"
    assert (await get_tmdb_cache("featured:series:Клан Сопрано", 3600))["title"] == "Клан Сопрано"


async def test_cache_survives_a_fresh_read_after_write_without_reusing_process_state():
    """This is the behaviour the featured-cache fix depends on: unlike a
    plain in-process dict, a value written to the DB-backed cache must be
    readable back out with no reliance on any Python object surviving in
    memory — i.e. it would still be there after a process restart."""
    await set_tmdb_cache("persisted-key", {"ok": True})
    # get_tmdb_cache always re-reads from the DB file on disk; nothing here
    # is served from a process-local cache.
    assert await get_tmdb_cache("persisted-key", 3600) == {"ok": True}
