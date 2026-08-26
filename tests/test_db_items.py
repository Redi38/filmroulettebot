"""Integration tests for app/db/database/items.py against a real (temp)
SQLite file — add/get/delete/rename, case-insensitivity, and the table
allowlist."""
from __future__ import annotations

import pytest

from app.db.database import add_item, delete_item, get_items, item_exists, rename_item

pytestmark = pytest.mark.usefixtures("initialized_db")


async def test_get_items_on_empty_table_returns_empty_list():
    assert await get_items("movies") == []


async def test_add_item_then_get_items():
    await add_item("movies", "Матрица")
    assert await get_items("movies") == ["Матрица"]


async def test_add_item_strips_whitespace():
    await add_item("movies", "  Дюна  ")
    assert await get_items("movies") == ["Дюна"]


async def test_add_item_rejects_empty_title():
    with pytest.raises(ValueError):
        await add_item("movies", "   ")


async def test_add_item_ignores_case_insensitive_duplicate():
    # NOTE: SQLite's built-in COLLATE NOCASE only case-folds ASCII
    # (A-Z/a-z) — it does *not* fold Cyrillic case, so an ASCII title is
    # used here to test the guarantee that actually holds. A Cyrillic
    # duplicate like "Матрица" / "МАТРИЦА" currently is *not* caught (see
    # test_add_item_cyrillic_case_is_not_folded_by_sqlite below) — that's
    # a pre-existing SQLite/schema limitation, not something this test
    # suite changes.
    await add_item("movies", "Inception")
    await add_item("movies", "INCEPTION")
    assert await get_items("movies") == ["Inception"]


async def test_add_item_cyrillic_case_is_not_folded_by_sqlite():
    # Documents a real, pre-existing limitation rather than asserting
    # aspirational behaviour: SQLite's NOCASE collation is ASCII-only, so
    # "Матрица" and "МАТРИЦА" are treated as distinct titles today.
    await add_item("movies", "Матрица")
    await add_item("movies", "МАТРИЦА")
    assert await get_items("movies") == ["Матрица", "МАТРИЦА"]


async def test_item_exists_is_case_insensitive_for_ascii():
    await add_item("series", "Breaking Bad")
    assert await item_exists("series", "breaking bad") is True
    assert await item_exists("series", "The Sopranos") is False


async def test_delete_item_removes_it():
    await add_item("cartoons", "Рик и Морти")
    await delete_item("cartoons", "Рик и Морти")
    assert await get_items("cartoons") == []


async def test_delete_item_is_a_no_op_for_missing_title():
    await delete_item("cartoons", "Никогда не существовавший тайтл")  # must not raise
    assert await get_items("cartoons") == []


async def test_rename_item_updates_the_title():
    await add_item("movies", "Матрица")
    await rename_item("movies", "Матрица", "Матрица (1999)")
    assert await get_items("movies") == ["Матрица (1999)"]


async def test_rename_item_rejects_empty_new_title():
    await add_item("movies", "Матрица")
    with pytest.raises(ValueError):
        await rename_item("movies", "Матрица", "   ")


async def test_items_are_isolated_per_table():
    await add_item("movies", "A")
    await add_item("series", "A")
    await delete_item("movies", "A")
    assert await get_items("movies") == []
    assert await get_items("series") == ["A"]


@pytest.mark.parametrize("fn, args", [
    (get_items, ("not_a_real_table",)),
    (item_exists, ("not_a_real_table", "x")),
    (add_item, ("not_a_real_table", "x")),
    (delete_item, ("not_a_real_table", "x")),
    (rename_item, ("not_a_real_table", "x", "y")),
])
async def test_unknown_table_is_rejected_by_every_entry_point(fn, args):
    with pytest.raises(ValueError):
        await fn(*args)
