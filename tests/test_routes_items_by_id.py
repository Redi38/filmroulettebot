"""Integration tests for the id-based rename/delete endpoints
(app/web/server/routes/items.py, routes/upcoming.py), through a real
FastAPI TestClient talking to a real (temp) SQLite DB.

These specifically cover the race the id-based rewrite exists to fix:
matching a rename/delete by title breaks once a previous request has
already changed that title out from under it (e.g. two open browser
tabs editing the same row) — matching by id doesn't have that problem,
since the row's id never changes.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.db.database import add_item, add_upcoming_movie, get_items_with_ids, get_upcoming_movies_with_ids

pytestmark = pytest.mark.usefixtures("db_path")


@pytest.fixture
def client(initialized_db):
    from app.web.server import app

    with TestClient(app) as c:
        yield c


async def _movie_id(title: str) -> int:
    items = await get_items_with_ids("movies")
    return next(i["id"] for i in items if i["title"] == title)


async def test_rename_by_id_survives_a_stale_title(client):
    """The core race: request A renames the row, then request B (which
    still only knows the *old* title) must still land on the same row via
    its id, rather than silently matching nothing."""
    await add_item("movies", "Матрица")
    item_id = await _movie_id("Матрица")

    r1 = client.post("/api/movies/rename", json={"id": item_id, "new_title": "Матрица (1999)"})
    assert r1.status_code == 200

    # Second "tab" still references the same id, unaware the title already
    # changed underneath it -- must still succeed, not 404.
    r2 = client.post("/api/movies/rename", json={"id": item_id, "new_title": "Матрица (1999) Remastered"})
    assert r2.status_code == 200

    items = await get_items_with_ids("movies")
    assert items == [{"id": item_id, "title": "Матрица (1999) Remastered"}]


async def test_rename_by_id_404s_if_row_was_deleted_meanwhile(client):
    await add_item("movies", "Начало")
    item_id = await _movie_id("Начало")

    del_r = client.post("/api/movies/delete", json={"id": item_id})
    assert del_r.status_code == 200

    # A second tab still holding the old id gets a clear 404, not a
    # silent no-op.
    rename_r = client.post("/api/movies/rename", json={"id": item_id, "new_title": "Ghost"})
    assert rename_r.status_code == 404


async def test_rename_by_id_conflict_excludes_self(client):
    """Renaming a row to (a case-different version of) its own current
    title must not be reported as a conflict with itself."""
    await add_item("movies", "Дюна")
    item_id = await _movie_id("Дюна")

    r = client.post("/api/movies/rename", json={"id": item_id, "new_title": "дюна"})
    assert r.status_code == 200


async def test_rename_by_id_conflict_with_other_row(client):
    await add_item("movies", "Дюна")
    await add_item("movies", "Дюна 2")
    item_id = await _movie_id("Дюна")

    r = client.post("/api/movies/rename", json={"id": item_id, "new_title": "Дюна 2"})
    assert r.status_code == 409


async def test_delete_by_id_is_idempotent(client):
    await add_item("movies", "Интерстеллар")
    item_id = await _movie_id("Интерстеллар")

    assert client.post("/api/movies/delete", json={"id": item_id}).status_code == 200
    # Deleting again (e.g. a second tab's stale button) must not error.
    assert client.post("/api/movies/delete", json={"id": item_id}).status_code == 200


async def test_items_endpoint_exposes_ids(client):
    await add_item("movies", "Оппенгеймер")
    r = client.get("/api/movies/items")
    assert r.status_code == 200
    items = r.json()["items"]
    assert items and set(items[0].keys()) == {"id", "title"}


async def test_upcoming_rename_by_id_survives_a_stale_title(client):
    await add_upcoming_movie("Дюна 3")
    items = await get_upcoming_movies_with_ids()
    item_id = items[0]["id"]

    r1 = client.post("/api/upcoming/rename", json={"id": item_id, "new_title": "Дюна: Мессия"})
    assert r1.status_code == 200
    r2 = client.post("/api/upcoming/rename", json={"id": item_id, "new_title": "Дюна: Мессия (2026)"})
    assert r2.status_code == 200

    items = await get_upcoming_movies_with_ids()
    assert items == [{"id": item_id, "title": "Дюна: Мессия (2026)"}]


async def test_upcoming_delete_by_id_is_idempotent(client):
    await add_upcoming_movie("Аватар 3")
    items = await get_upcoming_movies_with_ids()
    item_id = items[0]["id"]

    assert client.post("/api/upcoming/delete", json={"id": item_id}).status_code == 200
    assert client.post("/api/upcoming/delete", json={"id": item_id}).status_code == 200
