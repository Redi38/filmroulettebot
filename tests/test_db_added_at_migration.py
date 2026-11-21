"""The added_at column (the "added on <date>" caption in the web list) on a
database that was created before the column existed."""
from __future__ import annotations

import aiosqlite

from app.db.database import add_item, get_items_with_ids, init_db


async def test_init_db_adds_added_at_to_legacy_tables_as_null(db_path):
    """Old rows keep their place but get NULL (unknown) instead of an invented
    date; titles added afterwards get a real one."""
    async with aiosqlite.connect(db_path) as raw:
        await raw.execute(
            "CREATE TABLE movies (id INTEGER PRIMARY KEY AUTOINCREMENT, "
            "title TEXT UNIQUE NOT NULL COLLATE NOCASE, is_series INTEGER, position INTEGER)"
        )
        await raw.execute("INSERT INTO movies (title, position) VALUES ('Старый фильм', 1)")
        await raw.commit()

    await init_db()
    await add_item("movies", "Новый фильм")

    old, new = await get_items_with_ids("movies", with_added_at=True)
    assert old["title"] == "Старый фильм" and old["added_at"] is None
    assert new["title"] == "Новый фильм" and new["added_at"] is not None


async def test_init_db_is_idempotent_for_added_at(db_path):
    await init_db()
    await init_db()
    await add_item("series", "Во все тяжкие")
    [row] = await get_items_with_ids("series", with_added_at=True)
    assert row["added_at"] is not None
