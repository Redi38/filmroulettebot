"""One rule decides which cached TMDb entry (movie_info / series_info) backs a
poster, and the single, batched and backfill paths all follow it
(app/web/server/shared/posters.py, `_lookup_order`)."""
from __future__ import annotations

import pytest

from app.db.database import set_tmdb_cache
from app.web.server.shared import posters
from app.web.server.shared.posters import (
    _lookup_order,
    lookup_poster_info,
    lookup_poster_info_many,
)

MOVIE = {"title": "T", "poster_url": "https://img.test/movie.jpg"}
SERIES = {"title": "T", "poster_url": "https://img.test/series.jpg"}
NO_POSTER = {"title": "T", "poster_url": None}


@pytest.mark.parametrize(
    ("cat", "is_series", "expected"),
    [
        ("movies", None, ("movie_info",)),
        ("movies", True, ("movie_info",)),  # the flag only matters for dc/marvel
        ("cartoons", None, ("movie_info",)),
        ("series", None, ("series_info",)),
        ("series", False, ("series_info",)),
        ("dc", True, ("series_info", "movie_info")),
        ("marvel", True, ("series_info", "movie_info")),
        ("dc", False, ("movie_info", "series_info")),
        ("marvel", None, ("movie_info", "series_info")),  # legacy row: movie first
    ],
)
def test_lookup_order(cat, is_series, expected):
    assert _lookup_order(cat, is_series) == expected


@pytest.mark.usefixtures("initialized_db")
@pytest.mark.parametrize("is_series", [True, False, None])
@pytest.mark.parametrize(
    ("movie", "series"),
    [
        (MOVIE, SERIES),  # both cached: the flag picks
        (MOVIE, None),  # only one cached
        (None, SERIES),
        (NO_POSTER, SERIES),  # preferred-side entry exists but has no poster: fall through
        (MOVIE, NO_POSTER),
        (NO_POSTER, NO_POSTER),
        (None, None),
    ],
)
async def test_batched_lookup_matches_single_lookup(is_series, movie, series):
    if movie is not None:
        await set_tmdb_cache("movie_info:t", movie)
    if series is not None:
        await set_tmdb_cache("series_info:t", series)

    single = await lookup_poster_info("dc", "T", is_series)
    batched = await lookup_poster_info_many("dc", [("T", is_series)])
    assert batched == {"T": single}


@pytest.mark.usefixtures("initialized_db")
async def test_batched_lookup_handles_mixed_flags_in_one_call():
    await set_tmdb_cache("movie_info:t", MOVIE)
    await set_tmdb_cache("series_info:t", SERIES)
    out = await lookup_poster_info_many("dc", [("T", True), ("T", False)])
    # Keyed by title, so the last row for a title wins — but each row was
    # resolved with its *own* flag, not the first row's.
    assert out["T"] == MOVIE
    assert await lookup_poster_info_many("dc", [("T", False), ("T", True)]) == {"T": SERIES}


@pytest.mark.parametrize(
    ("cat", "is_series", "hits", "expected_calls"),
    [
        ("series", None, set(), ["series"]),
        ("movies", None, set(), ["movie"]),
        ("dc", True, set(), ["series", "movie"]),
        ("dc", False, set(), ["movie", "series"]),
        ("dc", None, set(), ["movie", "series"]),
        ("dc", True, {"series"}, ["series"]),  # first hit stops the fallback
        ("dc", False, {"movie"}, ["movie"]),
    ],
)
async def test_backfill_follows_the_same_order(monkeypatch, cat, is_series, hits, expected_calls):
    import asyncio

    calls: list[str] = []

    async def fake_movie(title):
        calls.append("movie")
        return {"poster_url": "x"} if "movie" in hits else None

    async def fake_series(title):
        calls.append("series")
        return {"poster_url": "x"} if "series" in hits else None

    monkeypatch.setattr(posters, "get_movie_info", fake_movie)
    monkeypatch.setattr(posters, "get_series_info", fake_series)
    posters._backfill_inflight.clear()

    # conftest replaces schedule_poster_backfill with a recorder; use the real one.
    real = posters.schedule_poster_backfill.original  # type: ignore[attr-defined]
    real(cat, "T", is_series)
    await asyncio.gather(*list(posters._backfill_tasks))

    assert calls == expected_calls
