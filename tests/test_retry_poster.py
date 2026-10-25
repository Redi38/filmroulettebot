"""The "no poster" row's re-check button: POST /api/{cat}/retry-poster and
/api/upcoming/retry-poster, backed by posters.retry_poster()."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.db.database import add_item, add_upcoming_movie, get_tmdb_cache, set_tmdb_cache
from app.web.server.shared import posters

pytestmark = pytest.mark.usefixtures("initialized_db")

NEW = {"title": "T", "poster_url": "https://img.test/new.jpg"}


def _patch_tmdb(monkeypatch, *, info, answered=True):
    calls: list[str] = []

    async def fake_movie(title):
        calls.append(title)
        return info

    async def fake_completed(media_type, title):
        return answered

    monkeypatch.setattr(posters, "get_movie_info", fake_movie)
    monkeypatch.setattr(posters, "search_completed", fake_completed)
    return calls


async def _seed_stale_no_poster():
    await set_tmdb_cache("movie_info:t", {"title": "T", "poster_url": None})
    await set_tmdb_cache("movie_search:t", {"results": []})
    await set_tmdb_cache(posters._miss_key("movies", "T"), {"no_poster": True})


async def test_retry_forgets_cached_answers_and_returns_new_poster(monkeypatch):
    await _seed_stale_no_poster()
    calls = _patch_tmdb(monkeypatch, info=NEW)

    assert await posters.retry_poster("movies", "T") == NEW["poster_url"]

    assert calls == ["T"]  # a real lookup, not the cached "no poster"
    assert await get_tmdb_cache("movie_search:t", 3600) is None  # stale search answer dropped too
    assert await get_tmdb_cache(posters._miss_key("movies", "T"), 3600) is None  # label marker cleared


async def test_retry_keeps_the_label_when_tmdb_still_has_nothing(monkeypatch):
    await _seed_stale_no_poster()
    _patch_tmdb(monkeypatch, info=None, answered=True)

    assert await posters.retry_poster("movies", "T") is None
    assert await get_tmdb_cache(posters._miss_key("movies", "T"), 3600) is not None


async def test_retry_does_not_label_when_tmdb_request_failed(monkeypatch):
    await _seed_stale_no_poster()
    _patch_tmdb(monkeypatch, info=None, answered=False)

    assert await posters.retry_poster("movies", "T") is None
    # Failed request != "no poster": no marker, so the row falls back to the blank slot.
    assert await get_tmdb_cache(posters._miss_key("movies", "T"), 3600) is None


@pytest.fixture
def client():
    from app.web.server import app

    with TestClient(app) as c:
        yield c


async def test_endpoint_returns_poster_for_a_listed_title(client, monkeypatch):
    await add_item("movies", "T")
    seen: list[tuple] = []

    async def fake_retry(cat, title, is_series=None):
        seen.append((cat, title, is_series))
        return "https://img.test/new.jpg"

    monkeypatch.setattr("app.web.server.routes.items.retry_poster", fake_retry)
    r = client.post("/api/movies/retry-poster", json={"title": "T"})
    assert r.status_code == 200
    assert r.json() == {"poster_url": "https://img.test/new.jpg"}
    assert seen == [("movies", "T", None)]


async def test_endpoint_poster_url_is_null_when_still_missing(client, monkeypatch):
    await add_item("movies", "T")

    async def fake_retry(cat, title, is_series=None):
        return None

    monkeypatch.setattr("app.web.server.routes.items.retry_poster", fake_retry)
    r = client.post("/api/movies/retry-poster", json={"title": "T"})
    assert r.status_code == 200
    assert r.json() == {"poster_url": None}


async def test_endpoint_rejects_titles_not_in_the_list(client, monkeypatch):
    async def boom(*a, **k):
        raise AssertionError("must not hit TMDb for a title that isn't listed")

    monkeypatch.setattr("app.web.server.routes.items.retry_poster", boom)
    assert client.post("/api/movies/retry-poster", json={"title": "Нет такого"}).status_code == 404
    assert client.post("/api/movies/retry-poster", json={"title": "  "}).status_code == 404
    assert client.post("/api/nope/retry-poster", json={"title": "T"}).status_code == 404


async def test_upcoming_endpoint(client, monkeypatch):
    await add_upcoming_movie("T")

    async def fake_retry(cat, title, is_series=None):
        assert cat == "movies"
        return "https://img.test/new.jpg"

    monkeypatch.setattr("app.web.server.routes.upcoming.retry_poster", fake_retry)
    r = client.post("/api/upcoming/retry-poster", json={"title": "T"})
    assert r.status_code == 200 and r.json() == {"poster_url": "https://img.test/new.jpg"}
    assert client.post("/api/upcoming/retry-poster", json={"title": "Нет такого"}).status_code == 404
