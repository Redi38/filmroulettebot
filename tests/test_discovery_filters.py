"""Integration tests for the server-side query params on the discovery
tabs: `digital` on /api/theaters, `status` on /api/series-releases, and
`order` on both.

All three run before paginate(), which is the reason they live on the
server at all — that's what the pagination tests pin down. TMDb and the
DB are stubbed throughout; these tests are about filtering and ordering,
not about what TMDb returns.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

pytestmark = pytest.mark.usefixtures("db_path")


def movie(title, date, rating=7.0, **extra):
    return {
        "id": abs(hash(title)) % 100000,
        "title": title,
        "original_title": title,
        "release_date": date,
        "poster_url": None,
        "overview": "",
        "rating": rating,
        "is_series": False,
        **extra,
    }


def titles(items):
    return [m["title"] for m in items]


def _stub_user_data(monkeypatch, theaters_module):
    """Stub out every DB read the two endpoints make.

    These tests care about filtering, not about lists — and going through
    the real (temp) DB would also mean each TestClient in this module
    touching the shared aiosqlite connection from its own event loop,
    which the module-level asyncio.Lock in app/db/database/connection.py
    doesn't survive being re-bound across.
    """
    async def empty_items(*args, **kwargs):
        return []

    async def no_setting(*args, **kwargs):
        return False

    monkeypatch.setattr(theaters_module, "get_items", empty_items)
    monkeypatch.setattr(theaters_module, "get_skipped", empty_items)
    monkeypatch.setattr(theaters_module, "get_upcoming_movies", empty_items)
    monkeypatch.setattr(theaters_module, "get_bool_setting", no_setting)


@pytest.fixture
def theaters_client(monkeypatch):
    """A TestClient with both TMDb listings stubbed to fixed data."""
    from app.web.server.routes import theaters as theaters_module

    now_playing = [
        movie("Now Digital", "2026-08-01", digitally_released=True),
        movie("Now Cinema", "2026-09-15", digitally_released=False),
    ]
    upcoming = [movie("Soon", "2026-09-25"), movie("Later", "2026-12-24")]

    async def fake_now(hide_local_only):
        return [dict(m) for m in now_playing]

    async def fake_upcoming(hide_local_only):
        return [dict(m) for m in upcoming]

    monkeypatch.setattr(theaters_module, "_get_processed_now_playing", fake_now)
    monkeypatch.setattr(theaters_module, "_get_processed_upcoming", fake_upcoming)
    _stub_user_data(monkeypatch, theaters_module)

    from app.web.server import app

    with TestClient(app) as client:
        yield client


class TestTheatersDigitalFilter:
    def test_unfiltered_returns_everything_in_source_order(self, theaters_client):
        data = theaters_client.get("/api/theaters").json()
        assert titles(data["now_playing"]) == ["Now Digital", "Now Cinema"]
        assert titles(data["upcoming"]) == ["Soon", "Later"]

    def test_digital_only(self, theaters_client):
        data = theaters_client.get("/api/theaters?digital=digital").json()
        assert titles(data["now_playing"]) == ["Now Digital"]

    def test_cinema_only(self, theaters_client):
        data = theaters_client.get("/api/theaters?digital=cinema").json()
        assert titles(data["now_playing"]) == ["Now Cinema"]

    def test_upcoming_column_is_untouched(self, theaters_client):
        # Nothing upcoming has a digital release yet, so filtering that
        # column would empty it rather than narrow it.
        for value in ("digital", "cinema"):
            data = theaters_client.get(f"/api/theaters?digital={value}").json()
            assert len(data["upcoming"]) == 2

    def test_unknown_value_is_rejected(self, theaters_client):
        assert theaters_client.get("/api/theaters?digital=vhs").status_code == 400

    def test_filtering_happens_before_pagination(self, theaters_client, monkeypatch):
        """The whole reason this filter lives server-side: the page count
        must describe the filtered list, not the raw one."""
        from app.web.server.routes import theaters as theaters_module

        many = [
            movie(f"M{i}", f"2026-09-{i:02d}", digitally_released=bool(i % 2))
            for i in range(1, 26)
        ]

        async def fake_now(hide_local_only):
            return [dict(m) for m in many]

        monkeypatch.setattr(theaters_module, "_get_processed_now_playing", fake_now)
        unfiltered = theaters_client.get("/api/theaters").json()
        filtered = theaters_client.get("/api/theaters?digital=digital").json()
        assert unfiltered["now_playing_total_pages"] > filtered["now_playing_total_pages"]
        assert all(m["digitally_released"] for m in filtered["now_playing"])


class TestTheatersOrdering:
    def test_default_keeps_source_order(self, theaters_client):
        data = theaters_client.get("/api/theaters?order=default").json()
        assert titles(data["now_playing"]) == ["Now Digital", "Now Cinema"]

    def test_order_by_date_is_ascending(self, theaters_client):
        data = theaters_client.get("/api/theaters?order=date").json()
        assert titles(data["now_playing"]) == ["Now Digital", "Now Cinema"]
        assert titles(data["upcoming"]) == ["Soon", "Later"]

    def test_undated_entries_sort_last(self, theaters_client, monkeypatch):
        from app.web.server.routes import theaters as theaters_module

        async def fake_now(hide_local_only):
            return [movie("Undated", ""), movie("Dated", "2026-09-15")]

        monkeypatch.setattr(theaters_module, "_get_processed_now_playing", fake_now)
        data = theaters_client.get("/api/theaters?order=date").json()
        assert titles(data["now_playing"]) == ["Dated", "Undated"]

    def test_pages_continue_the_calendar(self, theaters_client, monkeypatch):
        """The bug this param exists for: TMDb hands these listings over in
        popularity order, so paginating first and grouping by day second
        made every page restart from its own earliest date."""
        from app.web.server.routes import theaters as theaters_module

        # Deliberately shuffled: descending dates, so an unordered slice
        # would put the latest releases on page 1.
        many = [movie(f"M{i:02d}", f"2026-09-{i:02d}") for i in range(25, 0, -1)]

        async def fake_now(hide_local_only):
            return [dict(m) for m in many]

        monkeypatch.setattr(theaters_module, "_get_processed_now_playing", fake_now)
        page1 = theaters_client.get("/api/theaters?order=date&now_playing_page=1").json()
        page2 = theaters_client.get("/api/theaters?order=date&now_playing_page=2").json()
        last_of_page1 = page1["now_playing"][-1]["release_date"]
        first_of_page2 = page2["now_playing"][0]["release_date"]
        assert first_of_page2 > last_of_page1

    def test_unknown_order_is_rejected(self, theaters_client):
        assert theaters_client.get("/api/theaters?order=popularity").status_code == 400


@pytest.fixture
def series_client(monkeypatch):
    from app.web.server.routes import theaters as theaters_module

    releases = [
        {**movie("Debut", "2026-09-20", rating=8.0),
         "is_series": True, "is_new_series": True, "is_new_season": False, "airing_now": False},
        {**movie("Season 3", "2026-09-28", rating=9.1),
         "is_series": True, "is_new_series": False, "is_new_season": True, "airing_now": False},
        {**movie("Midseason", "2026-10-10", rating=7.4),
         "is_series": True, "is_new_series": False, "is_new_season": False, "airing_now": True},
        {**movie("Too Low", "2026-09-21", rating=5.0),
         "is_series": True, "is_new_series": True, "is_new_season": False, "airing_now": False},
    ]

    async def fake_releases():
        return [dict(m) for m in releases]

    monkeypatch.setattr(theaters_module, "get_series_releases", fake_releases)
    _stub_user_data(monkeypatch, theaters_module)

    from app.web.server import app

    with TestClient(app) as client:
        yield client


class TestSeriesStatusFilter:
    def test_rating_floor_still_applies(self, series_client):
        data = series_client.get("/api/series-releases").json()
        assert "Too Low" not in titles(data["releases"])

    def test_new_series(self, series_client):
        assert titles(series_client.get("/api/series-releases?status=new_series").json()["releases"]) == ["Debut"]

    def test_new_season(self, series_client):
        assert titles(series_client.get("/api/series-releases?status=new_season").json()["releases"]) == ["Season 3"]

    def test_airing(self, series_client):
        assert titles(series_client.get("/api/series-releases?status=airing").json()["releases"]) == ["Midseason"]

    def test_all_keeps_every_kind(self, series_client):
        data = series_client.get("/api/series-releases?status=all").json()
        assert titles(data["releases"]) == ["Debut", "Season 3", "Midseason"]

    def test_unknown_status_rejected(self, series_client):
        assert series_client.get("/api/series-releases?status=cancelled").status_code == 400

    def test_order_by_date(self, series_client):
        data = series_client.get("/api/series-releases?order=date").json()
        dates = [m["release_date"] for m in data["releases"]]
        assert dates == sorted(dates)
