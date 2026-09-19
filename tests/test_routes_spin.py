"""Integration tests for the spin/wheel/featured endpoints
(app/web/server/routes/spin.py), through a real FastAPI TestClient talking
to a real (temp) SQLite DB.

resolve_card_data (which fans out to TMDb + the watch-link scraper, both
of which hit the network) is stubbed out everywhere in this module — these
tests are about routing, cooldown, and caching behaviour, not TMDb.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.db.database import add_item

pytestmark = pytest.mark.usefixtures("db_path")


@pytest.fixture
def resolve_calls(monkeypatch):
    """Stub app.web.server.shared.resolve_card_data and count calls, so
    tests can assert on cache hits/misses without any network access."""
    from app.web.server import shared as shared_module

    calls = {"n": 0}

    async def _fake_resolve(category, title, is_series=None):
        calls["n"] += 1
        return {
            "category": category,
            "title": title,
            "original_title": title,
            "info": {"overview": "stub overview", "rating": 7.5},
            "watch_link": f"https://example.test/{title}",
        }

    monkeypatch.setattr(shared_module, "resolve_card_data", _fake_resolve)
    return calls


@pytest.fixture
def client(resolve_calls):
    from app.web.server import app as web_app

    with TestClient(web_app) as c:
        yield c


def _seed(cat: str, *titles: str) -> None:
    import asyncio

    async def _do():
        for t in titles:
            await add_item(cat, t)

    asyncio.run(_do())


# --- wheel-preview ----------------------------------------------------

def test_wheel_preview_returns_a_pool_of_titles(client):
    _seed("movies", "A", "B", "C")
    r = client.get("/api/movies/wheel-preview")
    assert r.status_code == 200
    body = r.json()
    assert set(body["wheel_pool"]) == {"A", "B", "C"}
    assert len(body["wheel_weights"]) == len(body["wheel_pool"])


def test_wheel_preview_404_on_empty_list(client):
    r = client.get("/api/movies/wheel-preview")
    assert r.status_code == 404


def test_wheel_preview_404_on_unknown_category(client):
    r = client.get("/api/not-a-real-category/wheel-preview")
    assert r.status_code == 404


def test_wheel_preview_400_for_non_roulette_category(client):
    # "dc" is a valid category but has no roulette (reference list only).
    _seed("dc", "Бэтмен")
    r = client.get("/api/dc/wheel-preview")
    assert r.status_code == 400


# --- random wheel preview / weights ----------------------------------------

def test_random_wheel_preview_has_titles_from_all_roulette_lists(client):
    _seed("movies", "M1", "M2")
    _seed("cartoons", "C1")
    _seed("series", "S1")
    r = client.get("/api/random/wheel-preview")
    assert r.status_code == 200
    body = r.json()
    assert sorted(body["wheel_pool"]) == ["C1", "M1", "M2", "S1"]
    assert len(body["wheel_weights"]) == len(body["wheel_pool"])


def test_random_wheel_preview_excludes_marvel_and_dc(client):
    _seed("movies", "M1")
    _seed("marvel", "Железный человек")
    _seed("dc", "Бэтмен")
    body = client.get("/api/random/wheel-preview").json()
    assert body["wheel_pool"] == ["M1"]


def test_random_wheel_preview_weighted_same_position_same_weight_across_lists(client):
    _seed("movies", "A", "B", "C")
    _seed("series", "D", "E")
    body = client.get("/api/random/wheel-preview?weighted=true").json()
    assert dict(zip(body["wheel_pool"], body["wheel_weights"])) == {"A": 3, "B": 2, "C": 1, "D": 3, "E": 2}


def test_random_wheel_preview_404_when_all_roulettes_are_empty(client):
    assert client.get("/api/random/wheel-preview").status_code == 404


def test_random_wheel_weights_follow_the_pool_order_sent(client):
    _seed("movies", "A", "B", "C")
    r = client.post("/api/random/wheel-weights", json={"pool": ["C", "A", "B"], "weighted": True})
    assert r.status_code == 200
    assert r.json()["wheel_weights"] == [1, 3, 2]


def test_random_wheel_weights_flat_in_normal_mode(client):
    _seed("movies", "A", "B")
    r = client.post("/api/random/wheel-weights", json={"pool": ["A", "B"], "weighted": False})
    assert r.json()["wheel_weights"] == [1, 1]


def test_random_wheel_weights_404_when_all_roulettes_are_empty(client):
    r = client.post("/api/random/wheel-weights", json={"pool": [], "weighted": True})
    assert r.status_code == 404


# --- spin / random-spin --------------------------------------------------

def test_spin_returns_a_card_and_saves_history(client):
    _seed("movies", "A", "B")
    r = client.post("/api/movies/spin", json={})
    assert r.status_code == 200
    body = r.json()
    assert body["original_title"] in {"A", "B"}
    assert body["watch_link"].startswith("https://example.test/")
    assert body["history_timestamp"] is not None


def test_spin_enforces_cooldown_between_requests(client):
    _seed("movies", "A", "B")
    r1 = client.post("/api/movies/spin", json={})
    assert r1.status_code == 200
    r2 = client.post("/api/movies/spin", json={})
    assert r2.status_code == 429


def test_spin_404_on_empty_list(client):
    r = client.post("/api/movies/spin", json={})
    assert r.status_code == 404


def test_random_spin_picks_from_any_non_empty_roulette_category(client):
    _seed("series", "OnlySeriesTitle")
    r = client.post("/api/random-spin", json={})
    assert r.status_code == 200
    assert r.json()["category"] == "series"


def test_random_spin_returns_the_single_combined_wheel(client):
    _seed("movies", "M1", "M2")
    _seed("cartoons", "C1")
    _seed("series", "S1")
    _seed("dc", "Бэтмен")
    body = client.post("/api/random-spin", json={}).json()
    # One wheel with every roulette title (and no Marvel/DC ones); the winner
    # is one of its segments and its card comes from the list it was drawn from.
    assert sorted(body["wheel_pool"]) == ["C1", "M1", "M2", "S1"]
    assert len(body["wheel_weights"]) == len(body["wheel_pool"])
    assert body["original_title"] in body["wheel_pool"]
    assert body["category"] in {"movies", "cartoons", "series"}


def test_random_spin_winner_card_matches_the_list_it_came_from(client):
    _seed("movies", "MovieOnly")
    _seed("series", "SeriesOnly")
    body = client.post("/api/random-spin", json={}).json()
    expected = {"MovieOnly": "movies", "SeriesOnly": "series"}
    assert body["category"] == expected[body["original_title"]]


def test_random_spin_never_picks_from_marvel_or_dc(client):
    _seed("dc", "Бэтмен")
    _seed("marvel", "Железный человек")
    assert client.post("/api/random-spin", json={}).status_code == 404


def test_random_spin_404_when_all_roulettes_are_empty(client):
    r = client.post("/api/random-spin", json={})
    assert r.status_code == 404


# --- featured (the persistent-cache fix) ---------------------------------

def test_featured_returns_first_item_card(client):
    _seed("movies", "First", "Second")
    r = client.get("/api/movies/featured")
    assert r.status_code == 200
    assert r.json()["original_title"] == "First"


def test_featured_404_on_empty_list(client):
    r = client.get("/api/movies/featured")
    assert r.status_code == 404


def test_featured_card_is_served_from_cache_on_second_call(client, resolve_calls):
    _seed("movies", "First")
    r1 = client.get("/api/movies/featured")
    r2 = client.get("/api/movies/featured")
    assert r1.json() == r2.json()
    # The whole point of caching: a second /featured hit must not re-run
    # the (network-bound) resolve step.
    assert resolve_calls["n"] == 1


def test_featured_cache_is_backed_by_the_db_not_process_memory(client, resolve_calls):
    """Regression test for the original bug: _featured_cache used to be a
    plain in-process dict, wiped by any uvicorn restart (deploy,
    healthcheck-restart). It's now stored in the same persistent
    `tmdb_cache` SQLite table TMDb responses use, so it survives that.

    We can't literally restart uvicorn in a unit test, but we can assert
    on the actual mechanism: the cached value is readable straight out of
    the DB, independent of any Python object still living in this
    process."""
    from app.db.database import get_tmdb_cache

    _seed("movies", "First")
    client.get("/api/movies/featured")
    assert resolve_calls["n"] == 1

    cached = None

    async def _read():
        nonlocal cached
        cached = await get_tmdb_cache("featured:movies:First", 600)

    import asyncio
    asyncio.run(_read())

    assert cached is not None
    assert cached["original_title"] == "First"


def test_featured_cache_key_is_scoped_per_category_and_title(client, resolve_calls):
    _seed("movies", "SameTitle")
    _seed("series", "SameTitle")
    client.get("/api/movies/featured")
    client.get("/api/series/featured")
    # Same title, different category -> two distinct cache entries, so both
    # trigger a resolve.
    assert resolve_calls["n"] == 2
