"""Poster thumbnails on the wheel segments: the cache-only lookup behind
`wheel_posters` (app/web/server/shared/posters.py) and how the spin routes
expose it, aligned segment-for-segment with `wheel_pool`.

Nothing here touches TMDb: posters are seeded straight into tmdb_cache, and
the background backfill is the recorder from conftest (`backfill_calls`).
"""
from __future__ import annotations

import asyncio

import pytest
from fastapi.testclient import TestClient

from app.db.database import add_item, set_tmdb_cache
from app.web.server.shared.posters import resolve_wheel_posters

pytestmark = pytest.mark.usefixtures("db_path")

_BASE = "https://image.tmdb.org/t/p"


def _cache_poster(kind: str, title: str, size: str = "w500") -> None:
    async def _do():
        await set_tmdb_cache(f"{kind}_info:{title.strip().lower()}", {"poster_url": f"{_BASE}/{size}/{title}.jpg"})

    asyncio.run(_do())


def _seed(cat: str, *titles: str) -> None:
    async def _do():
        for t in titles:
            await add_item(cat, t)

    asyncio.run(_do())


@pytest.fixture
def client():
    from app.web.server import app as web_app

    with TestClient(web_app) as c:
        yield c


# --- resolve_wheel_posters ------------------------------------------------

async def test_cached_poster_is_returned_in_entry_order_at_wheel_size(initialized_db, backfill_calls):
    await set_tmdb_cache("movie_info:a", {"poster_url": f"{_BASE}/w500/a.jpg"})
    await set_tmdb_cache("movie_info:b", {"poster_url": f"{_BASE}/w500/b.jpg"})
    out = await resolve_wheel_posters([("movies", "B", None), ("movies", "A", None)])
    assert out == [f"{_BASE}/w342/b.jpg", f"{_BASE}/w342/a.jpg"]
    assert backfill_calls == []


async def test_missing_poster_is_none_and_schedules_a_backfill(initialized_db, backfill_calls):
    await set_tmdb_cache("movie_info:a", {"poster_url": f"{_BASE}/w500/a.jpg"})
    out = await resolve_wheel_posters([("movies", "A", None), ("movies", "Nope", None)])
    assert out == [f"{_BASE}/w342/a.jpg", None]
    assert backfill_calls == [("movies", "Nope", None)]


async def test_backfills_per_call_are_capped_across_categories(initialized_db, backfill_calls):
    from app.web.server.shared.posters import WHEEL_BACKFILL_PER_CALL

    extra = 6
    entries = [("movies", f"M{i}", None) for i in range(WHEEL_BACKFILL_PER_CALL)]
    entries += [("series", f"S{i}", None) for i in range(extra)]
    out = await resolve_wheel_posters(entries)
    assert out == [None] * len(entries)  # a miss still yields a placeholder for its segment
    assert len(backfill_calls) == WHEEL_BACKFILL_PER_CALL


async def test_same_title_in_two_categories_resolves_per_category(initialized_db, backfill_calls):
    # "Фонари" exists as both a film and a series; each segment must use its own lookup.
    await set_tmdb_cache("movie_info:x", {"poster_url": f"{_BASE}/w500/film.jpg"})
    await set_tmdb_cache("series_info:x", {"poster_url": f"{_BASE}/w500/show.jpg"})
    out = await resolve_wheel_posters([("movies", "X", None), ("series", "X", None)])
    assert out == [f"{_BASE}/w342/film.jpg", f"{_BASE}/w342/show.jpg"]


async def test_lot_uses_is_series_to_pick_between_film_and_show(initialized_db, backfill_calls):
    await set_tmdb_cache("movie_info:x", {"poster_url": f"{_BASE}/w500/film.jpg"})
    await set_tmdb_cache("series_info:x", {"poster_url": f"{_BASE}/w500/show.jpg"})
    as_show = await resolve_wheel_posters([("dc", "X", True)])
    as_film = await resolve_wheel_posters([("dc", "X", False)])
    assert as_show == [f"{_BASE}/w342/show.jpg"]
    assert as_film == [f"{_BASE}/w342/film.jpg"]


async def test_empty_input_is_empty_output(initialized_db):
    assert await resolve_wheel_posters([]) == []


# --- backfill task lifecycle ---------------------------------------------

async def test_backfill_task_is_held_until_done_and_deduplicated(monkeypatch):
    from app.web.server.shared import posters

    started, release = asyncio.Event(), asyncio.Event()
    lookups: list[str] = []

    async def _slow_movie_info(title):
        lookups.append(title)
        started.set()
        await release.wait()
        return {"poster_url": "x"}

    monkeypatch.setattr(posters, "get_movie_info", _slow_movie_info)
    schedule = posters.schedule_poster_backfill.original  # the real one; conftest stubs the module attr

    schedule("movies", "Dune")
    schedule("movies", "  dune ")  # same title, same category -> no second task
    await started.wait()
    assert len(posters._backfill_tasks) == 1  # strong ref kept while running
    assert ("movies", "dune") in posters._backfill_inflight

    tasks = list(posters._backfill_tasks)
    release.set()
    await asyncio.gather(*tasks)
    await asyncio.sleep(0)  # let the done-callbacks run
    assert lookups == ["Dune"]
    assert not posters._backfill_tasks
    assert not posters._backfill_inflight


# --- routes ---------------------------------------------------------------

def test_wheel_preview_posters_line_up_with_the_pool(client):
    _seed("movies", "A", "B")
    _cache_poster("movie", "A")
    body = client.get("/api/movies/wheel-preview").json()
    assert len(body["wheel_posters"]) == len(body["wheel_pool"])
    by_title = dict(zip(body["wheel_pool"], body["wheel_posters"]))
    assert by_title["A"] == f"{_BASE}/w342/A.jpg"
    assert by_title["B"] is None


def test_random_wheel_lot_segment_carries_the_poster_of_the_lists_first_title(client):
    _seed("movies", "A")
    _seed("marvel", "Железный человек", "Тор")
    _cache_poster("movie", "Железный человек")
    _cache_poster("movie", "Тор")
    body = client.get("/api/random/wheel-preview").json()
    by_label = dict(zip(body["wheel_pool"], body["wheel_posters"]))
    # The segment reads "Marvel" but shows the poster of what a landing there resolves to.
    assert by_label["Marvel"] == f"{_BASE}/w342/Железный человек.jpg"
    assert by_label["A"] is None


def test_spin_response_posters_line_up_with_the_pool(client):
    _seed("series", "S1", "S2")
    _cache_poster("series", "S1")
    body = client.post("/api/series/spin", json={}).json()
    assert len(body["wheel_posters"]) == len(body["wheel_pool"])
    by_title = dict(zip(body["wheel_pool"], body["wheel_posters"]))
    assert by_title["S1"] == f"{_BASE}/w342/S1.jpg"
    assert by_title["S2"] is None
