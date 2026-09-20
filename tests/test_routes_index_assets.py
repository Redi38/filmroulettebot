"""index.html templating and static cache policy (app/web/server/shared/
assets.py + the middleware in app/web/server/__init__.py), plus the
response_model on /api/{cat}/sequel."""
from __future__ import annotations

import re

import pytest
from fastapi.testclient import TestClient

from app.db.database import add_item, get_items

pytestmark = pytest.mark.usefixtures("db_path")


@pytest.fixture
def client():
    from app.web.server import app

    with TestClient(app) as c:
        yield c


def test_index_is_rendered_not_served_raw(client):
    r = client.get("/")
    assert r.status_code == 200
    html = r.text
    assert "{{" not in html, "an unreplaced template placeholder leaked into index.html"
    assert r.headers["cache-control"] == "no-cache"
    # constants.js is inlined for the pre-bundle header title.
    assert "const VIEW_TITLES" in html
    assert "function viewTitleFor" in html
    # Both bundles carry a version query.
    assert re.search(r'bundle\.min\.css\?v=[0-9a-f]{12}|bundle\.min\.css\?v=dev', html)
    assert re.search(r'bundle\.min\.js\?v=[0-9a-f]{12}|bundle\.min\.js\?v=dev', html)


def test_history_is_a_panel_on_the_roulette_screen_not_a_section(client):
    html = client.get("/").text
    assert 'id="history-section"' not in html
    spin = html[html.index('id="spin-section"'):html.index('id="list-section"')]
    for needle in ('id="history-fab"', 'id="history-panel"', 'id="history-container"'):
        assert needle in spin, f"{needle} should sit inside the roulette section"
    # The inlined constants no longer name a "history" view for the header.
    assert 'history: "История"' not in html


def test_asset_version_tracks_file_contents(tmp_path):
    from app.web.server.shared.assets import asset_version

    f = tmp_path / "b.js"
    f.write_text("a")
    v1 = asset_version(f)
    f.write_text("b")
    assert asset_version(f) != v1
    assert asset_version(tmp_path / "missing.js") == "dev"


def test_versioned_dist_assets_are_immutable(client):
    # favicon.svg is a real, always-present static file with no version.
    r = client.get("/static/favicon.svg")
    assert r.status_code == 200
    assert "max-age=3600" in r.headers["cache-control"]

    # Anything under a dist/ folder with ?v= is cached forever — the URL
    # changes whenever the content does, so this is safe. Works whether or
    # not the bundle has been built in this checkout (404 has no policy).
    r = client.get("/static/js/dist/bundle.min.js?v=abcdef123456")
    if r.status_code == 200:
        assert r.headers["cache-control"] == "public, max-age=31536000, immutable"


async def test_sequel_returns_typed_body(client):
    await add_item("movies", "Dune")
    r = client.post("/api/movies/sequel", json={"title": "Dune"})
    assert r.status_code == 200
    assert r.json() == {"ok": True, "new_title": "Dune 2"}
    assert await get_items("movies") == ["Dune 2"]

    schema = client.get("/openapi.json").json()
    resp = schema["paths"]["/api/{cat}/sequel"]["post"]["responses"]["200"]
    assert resp["content"]["application/json"]["schema"]["$ref"].endswith("/SequelResponse")
