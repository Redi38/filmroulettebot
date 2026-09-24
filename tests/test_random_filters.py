"""Tests for the "Рандом" wheel preferences (shared/random_filters.py):
"only films" drops the series list, "max runtime" drops long films only,
through the real random-wheel endpoints and a temp SQLite DB."""
from __future__ import annotations

import asyncio

import pytest
from fastapi.testclient import TestClient

from app.db.database import add_item, set_tmdb_cache

pytestmark = pytest.mark.usefixtures("db_path")


@pytest.fixture
def client(monkeypatch):
    from app.web.server import app as web_app
    from app.web.server.shared import card as card_module

    async def _fake_resolve(category, title, is_series=None):
        return {
            "category": category, "title": title, "original_title": title,
            "info": {}, "watch_link": None,
        }

    monkeypatch.setattr(card_module, "resolve_card_data", _fake_resolve)
    with TestClient(web_app) as c:
        yield c


def _seed(cat: str, *titles: str, is_series: bool | None = None) -> None:
    async def _do():
        for t in titles:
            await add_item(cat, t, is_series)

    asyncio.run(_do())


def _runtime(title: str, minutes) -> None:
    info = {"title": title, "runtime": minutes, "poster_url": f"https://image.test/t/p/w500/{title}.jpg"}
    asyncio.run(set_tmdb_cache(f"movie_info:{title.lower()}", info))


def _preview(client, **params) -> list[str]:
    r = client.get("/api/random/wheel-preview", params=params)
    assert r.status_code == 200, r.text
    return r.json()["wheel_pool"]


def _library(client) -> None:
    _seed("movies", "Short Film", "Long Film")
    _seed("series", "Some Show")
    _seed("cartoons", "Short Cartoon", "Long Cartoon")
    _seed("cartoons", "Cartoon Show", is_series=True)
    _seed("marvel", "Long Marvel Film")
    _seed("dc", "DC Show", is_series=True)
    _runtime("Short Film", 95)
    _runtime("Long Film", 150)
    _runtime("Short Cartoon", 88)
    _runtime("Long Cartoon", 130)
    _runtime("Long Marvel Film", 149)


def test_no_filters_keeps_everything(client):
    _library(client)
    pool = _preview(client)
    assert set(pool) == {
        "Short Film", "Long Film", "Some Show", "Short Cartoon", "Long Cartoon", "Cartoon Show",
        "Marvel", "DC",
    }


def test_films_only_drops_the_series_list_but_keeps_cartoons_and_lots(client):
    _library(client)
    pool = _preview(client, films_only=True)
    assert "Some Show" not in pool
    assert {"Short Film", "Long Film", "Short Cartoon", "Long Cartoon", "Cartoon Show", "Marvel", "DC"} <= set(pool)


def test_max_runtime_drops_long_films_but_keeps_series(client):
    _library(client)
    pool = set(_preview(client, max_runtime=120))
    assert "Long Film" not in pool
    assert "Long Cartoon" not in pool
    assert "Marvel" not in pool  # the lot's film runs 149 min
    assert {"Short Film", "Short Cartoon"} <= pool
    # Series aren't touched by the length limit when films_only is off.
    assert {"Some Show", "Cartoon Show", "DC"} <= pool


def test_both_filters_together(client):
    _library(client)
    pool = set(_preview(client, films_only=True, max_runtime=120))
    assert pool == {"Short Film", "Short Cartoon", "Cartoon Show", "DC"}


def test_runtime_limit_is_inclusive(client):
    _seed("movies", "Exactly Two Hours", "Other")
    _runtime("Exactly Two Hours", 120)
    _runtime("Other", 121)
    _runtime("Also Short", 60)
    _seed("movies", "Also Short")
    assert set(_preview(client, max_runtime=120)) == {"Exactly Two Hours", "Also Short"}


def test_unknown_runtime_stays_and_is_backfilled(client, backfill_calls):
    _seed("movies", "Never Opened", "Known Short")
    _runtime("Known Short", 90)
    _runtime("Placeholder Runtime", "—")
    _seed("movies", "Placeholder Runtime")
    pool = set(_preview(client, max_runtime=120))
    assert pool == {"Never Opened", "Known Short", "Placeholder Runtime"}
    # Only the uncached one needs a lookup; the "—" one was already resolved.
    assert [t for _, t, _ in backfill_calls] == ["Never Opened"] * backfill_calls.count(
        ("movies", "Never Opened", None)
    )
    assert ("movies", "Never Opened", None) in backfill_calls


def test_filters_keep_the_surviving_titles_weights(client):
    _seed("movies", "First", "Second", "Third")
    _runtime("First", 200)
    _runtime("Second", 90)
    _runtime("Third", 90)
    r = client.get("/api/random/wheel-preview", params={"weighted": True, "max_runtime": 120})
    body = r.json()
    weights = dict(zip(body["wheel_pool"], body["wheel_weights"]))
    # Positions still count from the unfiltered list: Second was 2nd of 3.
    assert weights["Second"] == 2
    assert weights["Third"] == 1


def test_filters_that_empty_the_wheel_give_a_distinct_404(client):
    _seed("series", "Only A Show")
    r = client.get("/api/random/wheel-preview", params={"films_only": True})
    assert r.status_code == 404
    assert "фильтр" in r.json()["detail"]


def test_empty_library_keeps_its_own_404_with_filters_on(client):
    r = client.get("/api/random/wheel-preview", params={"films_only": True})
    assert r.status_code == 404
    assert "фильтр" not in r.json()["detail"]


def test_random_spin_honours_the_filters(client):
    _library(client)
    for _ in range(15):
        from app.web.server.shared.spin_state import _last_spin_at

        _last_spin_at.clear()
        r = client.post("/api/random-spin", json={"films_only": True, "max_runtime": 120})
        assert r.status_code == 200, r.text
        assert r.json()["original_title"] in {"Short Film", "Short Cartoon", "Cartoon Show", "DC Show"}
        assert "Some Show" not in r.json()["wheel_pool"]


def test_random_spin_rejects_a_nonsense_runtime(client):
    _seed("movies", "A", "B")
    assert client.post("/api/random-spin", json={"max_runtime": 0}).status_code == 422
    assert client.get("/api/random/wheel-preview", params={"max_runtime": 9999}).status_code == 422


def test_per_category_spin_ignores_the_filter_fields(client):
    _seed("series", "Show A", "Show B")
    r = client.post("/api/series/spin", json={"films_only": True})
    assert r.status_code == 200
