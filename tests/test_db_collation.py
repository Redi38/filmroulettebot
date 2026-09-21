"""UNICODE_NOCASE collation registration and the list-table constants
(app/db/database/connection.py)."""
from __future__ import annotations

import pytest

from app.db.database import connection
from app.db.database.connection import ALLOWED_TABLES, NOCASE_TABLES, check_table, conn

pytestmark = pytest.mark.usefixtures("initialized_db")


def test_one_table_list_backs_both_constants():
    assert set(NOCASE_TABLES) == ALLOWED_TABLES
    assert len(set(NOCASE_TABLES)) == len(NOCASE_TABLES)


def test_check_table_allowlist():
    for table in NOCASE_TABLES:
        check_table(table)
    with pytest.raises(ValueError):
        check_table("sqlite_master")


@pytest.mark.parametrize(
    ("a", "b"),
    [("Фонари", "фонари"), ("ЁЖИК", "ёжик"), ("Batman", "BATMAN"), ("Straße", "STRASSE")],
)
async def test_collation_folds_case_beyond_ascii(a, b):
    """SQLite's built-in NOCASE only folds ASCII; this is why the app registers
    its own collation, and the test that pins the private aiosqlite hook."""
    async with conn() as db:
        cur = await db.execute("SELECT ? = ? COLLATE UNICODE_NOCASE", (a, b))
        assert (await cur.fetchone())[0] == 1


async def test_collation_is_registered_on_the_read_connection_too():
    async with connection.read_conn() as db:
        cur = await db.execute("SELECT 'Я' = 'я' COLLATE UNICODE_NOCASE")
        assert (await cur.fetchone())[0] == 1


async def test_unique_title_index_is_case_insensitive_for_cyrillic():
    from app.db.database import add_item, item_exists

    await add_item("movies", "Побег из Шоушенка")
    assert await item_exists("movies", "побег из шоушенка")
