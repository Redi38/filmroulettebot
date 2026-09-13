"""A dc/marvel list can hold a film and a show under the same name — the
canonical case is "Фонари", which is both a 2026 film and the "Lanterns"
series. Which one a row means is not derivable from the title; it's the
`is_series` flag recorded when the user picked a result in the add/rename
search. Before this was threaded through, every read guessed movie-first,
so a row the user had explicitly picked the series for still showed the
film's poster on the Афиша and the film's runtime/overview on its card.
"""
from __future__ import annotations

import pytest

from app.db.database import add_item, get_item_is_series, rename_item_by_id

pytestmark = pytest.mark.usefixtures("initialized_db")

MOVIE_INFO = {"title": "Фонари", "poster_url": "https://img.test/movie.jpg", "runtime": 13}
SERIES_INFO = {"title": "Фонари", "poster_url": "https://img.test/series.jpg", "seasons": 1}


async def test_is_series_round_trips_through_add_and_rename():
    await add_item("dc", "Фонари", is_series=True)
    assert await get_item_is_series("dc", "Фонари") is True

    rows = {r["title"]: r["id"] for r in await _rows("dc")}
    await rename_item_by_id("dc", rows["Фонари"], "Фонари", is_series=False)
    assert await get_item_is_series("dc", "Фонари") is False


async def test_unknown_flag_is_none_for_legacy_rows():
    await add_item("dc", "Бэтмен")
    assert await get_item_is_series("dc", "Бэтмен") is None


@pytest.mark.parametrize(
    ("is_series", "expected_poster"),
    [(True, SERIES_INFO["poster_url"]), (False, MOVIE_INFO["poster_url"])],
)
async def test_poster_lookup_follows_the_stored_flag(is_series, expected_poster):
    """Both cache entries exist for the same title — the flag has to pick."""
    from app.db.database import set_tmdb_cache
    from app.web.server.shared.posters import lookup_poster_url

    await set_tmdb_cache("movie_info:фонари", MOVIE_INFO)
    await set_tmdb_cache("series_info:фонари", SERIES_INFO)

    assert await lookup_poster_url("dc", "Фонари", is_series) == expected_poster


@pytest.mark.parametrize(
    ("is_series", "expected_first"), [(True, "series"), (False, "movie"), (None, "movie")]
)
async def test_card_lookup_tries_the_picked_kind_first(monkeypatch, is_series, expected_first):
    """The *order* is what matters: whichever kind is tried first wins when
    TMDb has a hit for both, which is exactly the ambiguous case."""
    from app.services import card_data

    tried: list[str] = []

    async def fake_movie(title):
        tried.append("movie")
        return MOVIE_INFO

    async def fake_series(title):
        tried.append("series")
        return SERIES_INFO

    monkeypatch.setattr(card_data, "get_movie_info", fake_movie)
    monkeypatch.setattr(card_data, "get_series_info", fake_series)

    info = await card_data._fetch_tmdb_info("dc", "Фонари", is_series)

    assert tried[0] == expected_first
    assert len(tried) == 1  # a hit on the first try must not fall through
    assert info is (SERIES_INFO if expected_first == "series" else MOVIE_INFO)


async def test_card_lookup_falls_back_when_the_picked_kind_has_no_match(monkeypatch):
    from app.services import card_data

    async def fake_movie(title):
        return MOVIE_INFO

    async def fake_series(title):
        return None

    monkeypatch.setattr(card_data, "get_movie_info", fake_movie)
    monkeypatch.setattr(card_data, "get_series_info", fake_series)

    assert await card_data._fetch_tmdb_info("dc", "Фонари", True) is MOVIE_INFO


async def _rows(cat):
    from app.db.database import get_items_with_ids

    return await get_items_with_ids(cat)
