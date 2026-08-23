"""Generic per-table CRUD shared by every list-backed table (roulette
categories, upcoming movies, tracked series)."""
from __future__ import annotations

from .connection import check_table, conn, retry_on_lock


async def get_items(table: str) -> list[str]:
    check_table(table)
    async with conn() as db:
        async with db.execute(f"SELECT title FROM {table}") as cur:
            return [row[0] async for row in cur]


async def item_exists(table: str, title: str) -> bool:
    """Case-insensitive existence check (relies on COLLATE NOCASE on the column)."""
    check_table(table)
    async with conn() as db:
        async with db.execute(f"SELECT 1 FROM {table} WHERE title = ? LIMIT 1", (title,)) as cur:
            return await cur.fetchone() is not None


@retry_on_lock
async def add_item(table: str, title: str) -> None:
    check_table(table)
    title = title.strip()
    if not title:
        raise ValueError("Title cannot be empty.")
    async with conn() as db:
        await db.execute(f"INSERT OR IGNORE INTO {table} (title) VALUES (?)", (title,))
        await db.commit()


@retry_on_lock
async def delete_item(table: str, title: str) -> None:
    check_table(table)
    async with conn() as db:
        await db.execute(f"DELETE FROM {table} WHERE title = ?", (title,))
        await db.commit()


@retry_on_lock
async def rename_item(table: str, old_title: str, new_title: str) -> None:
    check_table(table)
    new_title = new_title.strip()
    if not new_title:
        raise ValueError("Title cannot be empty.")
    async with conn() as db:
        await db.execute(f"UPDATE {table} SET title = ? WHERE title = ?", (new_title, old_title))
        await db.commit()
