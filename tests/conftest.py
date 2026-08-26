"""Shared pytest fixtures.

Settings() (app/config.py) requires TOKEN and TMDB_API_KEY with no
defaults, and is constructed once at import time. These env vars must be
set *before* anything imports app.config for the first time, so they're
set here, at conftest module load — pytest always imports conftest.py
before collecting test modules.
"""
from __future__ import annotations

import os

os.environ.setdefault("TOKEN", "test-token")
os.environ.setdefault("TMDB_API_KEY", "test-tmdb-key")

import pytest


@pytest.fixture
def db_path(tmp_path, monkeypatch):
    """Point the DB layer at a fresh temp SQLite file for this test.

    app/db/database/connection.py reads settings.DB_PATH fresh on every
    connection rather than caching it, so patching the attribute here is
    enough to isolate each test's data — no need to re-import anything.
    """
    from app.config import settings

    path = tmp_path / "test.db"
    monkeypatch.setattr(settings, "DB_PATH", str(path))
    return str(path)


@pytest.fixture
async def initialized_db(db_path):
    """Same as db_path, but with the schema already created — for tests
    that talk to app.db.database directly without going through a FastAPI
    app (whose startup event would otherwise call init_db() itself)."""
    from app.db.database import init_db

    await init_db()
    return db_path


@pytest.fixture(autouse=True)
def _reset_spin_state():
    """_last_spin_at / _last_spin_title (app/web/server/shared.py) are
    plain module-level state shared by every test in the session — without
    resetting them, one test's cooldown timestamp (keyed by TestClient's
    fixed "testclient" IP) would leak into the next and cause spurious 429s.
    """
    from app.web.server.shared import _last_spin_at, _last_spin_title

    _last_spin_at.clear()
    _last_spin_title.clear()
    yield
    _last_spin_at.clear()
    _last_spin_title.clear()
