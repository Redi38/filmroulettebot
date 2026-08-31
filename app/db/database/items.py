"""Generic per-table CRUD shared by every list-backed table (roulette
categories, upcoming movies, tracked series)."""
from __future__ import annotations

from .connection import check_table, conn, retry_on_lock


async def get_items(table: str) -> list[str]:
    check_table(table)
    async with conn() as db:
        async with db.execute(f"SELECT title FROM {table}") as cur:
            return [row[0] async for row in cur]


async def get_items_with_ids(table: str) -> list[dict]:
    """Same as get_items(), but keeps each row's stable id alongside its
    title. Callers that let the user rename/delete a *specific row* (as
    opposed to a fire-and-forget add) should prefer this + delete_item_by_id/
    rename_item_by_id over the title-based CRUD below: matching by title
    means two concurrent renames of the same row (e.g. two open browser
    tabs) can silently miss each other once the first one lands, since the
    second request's WHERE title = <old title> no longer matches anything.
    Matching by id doesn't have that problem — the row's id never changes."""
    check_table(table)
    async with conn() as db:
        async with db.execute(f"SELECT id, title FROM {table}") as cur:
            return [{"id": row[0], "title": row[1]} async for row in cur]


async def item_exists(table: str, title: str) -> bool:
    """Case-insensitive existence check (relies on COLLATE UNICODE_NOCASE on
    the column — see connection.py for why the built-in NOCASE isn't enough)."""
    check_table(table)
    async with conn() as db:
        async with db.execute(f"SELECT 1 FROM {table} WHERE title = ? LIMIT 1", (title,)) as cur:
            return await cur.fetchone() is not None


async def item_exists_other_id(table: str, title: str, exclude_id: int) -> bool:
    """Case-insensitive existence check excluding one row by id — for rename
    conflict checks, where the row's own (about-to-be-overwritten) title
    obviously shouldn't count as a conflict with itself."""
    check_table(table)
    async with conn() as db:
        async with db.execute(
            f"SELECT 1 FROM {table} WHERE title = ? AND id != ? LIMIT 1", (title, exclude_id)
        ) as cur:
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
async def delete_item_by_id(table: str, item_id: int) -> None:
    check_table(table)
    async with conn() as db:
        await db.execute(f"DELETE FROM {table} WHERE id = ?", (item_id,))
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


@retry_on_lock
async def rename_item_by_id(table: str, item_id: int, new_title: str) -> bool:
    """Returns False if item_id no longer exists (e.g. deleted by another
    tab/request in between) rather than silently doing nothing, so the
    caller can tell the difference and surface a real 404."""
    check_table(table)
    new_title = new_title.strip()
    if not new_title:
        raise ValueError("Title cannot be empty.")
    async with conn() as db:
        cur = await db.execute(f"UPDATE {table} SET title = ? WHERE id = ?", (new_title, item_id))
        await db.commit()
        return cur.rowcount > 0

