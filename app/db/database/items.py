"""Generic per-table CRUD shared by every list-backed table (roulette
categories, upcoming movies, tracked series)."""
from __future__ import annotations

from .connection import check_table, conn, read_conn, retry_on_lock


async def get_item_counts(tables: list[str]) -> dict[str, int]:
    """COUNT(*) for several tables in one round trip (one UNION ALL query)
    instead of one `SELECT title FROM <table>` per table with the whole
    result pulled into Python just to take len() of it — used by
    /api/categories, which previously issued 7 full-table scans on every
    call just to report how many rows each category has."""
    for t in tables:
        check_table(t)
    if not tables:
        return {}
    union_sql = " UNION ALL ".join(f"SELECT '{t}' AS tbl, COUNT(*) AS n FROM {t}" for t in tables)
    async with read_conn() as db:
        async with db.execute(union_sql) as cur:
            rows = await cur.fetchall()
    return {row[0]: row[1] for row in rows}


async def get_items(table: str) -> list[str]:
    check_table(table)
    async with read_conn() as db:
        async with db.execute(f"SELECT title FROM {table} ORDER BY position, id") as cur:
            return [row[0] async for row in cur]


async def get_items_with_ids(table: str) -> list[dict]:
    """Same as get_items(), but keeps each row's stable id (and, when
    known, is_series) alongside its title. Callers that let the user
    rename/delete a *specific row* (as opposed to a fire-and-forget add)
    should prefer this + delete_item_by_id/rename_item_by_id over the
    title-based CRUD below: matching by title means two concurrent renames
    of the same row (e.g. two open browser tabs) can silently miss each
    other once the first one lands, since the second request's WHERE
    title = <old title> no longer matches anything. Matching by id doesn't
    have that problem — the row's id never changes.

    ORDER BY id is explicit (not incidental) on purpose: rows are meant to
    stay in the order they were added (e.g. franchise watch order for
    dc/marvel), not get reshuffled alphabetically. Without an explicit
    ORDER BY, row order is whatever SQLite's query planner happens to pick
    for that exact column list — which can silently change: selecting just
    (id, title) is small enough that SQLite sometimes satisfies it straight
    from the title-unique index (title order) instead of scanning the
    table (id/insertion order), and adding is_series to the select list
    flips that choice back. That's what happened here: the two functions
    drifted out of sync with each other, and both drifted away from
    insertion order. Pin the order explicitly so it can't silently move
    again as columns get added to either query in the future.

    Ordered by `position` (falling back to `id` for a tie, which only
    happens for legacy rows never touched by move_item) rather than plain
    `id` so a user can reorder rows — see move_item() below — independently
    of when they were added; the weighted roulette mode reads a title's
    odds straight off this order (title_weights() in app/services/titles.py)."""
    check_table(table)
    async with read_conn() as db:
        async with db.execute(
            f"SELECT id, title, is_series FROM {table} ORDER BY position, id"
        ) as cur:
            return [
                {"id": row[0], "title": row[1], "is_series": None if row[2] is None else bool(row[2])}
                async for row in cur
            ]


async def get_item_is_series(table: str, title: str) -> bool | None:
    """The stored movie-vs-series flag for a single row, matched by title.

    dc/marvel lists hold films and shows side by side, and a franchise can
    have both under the same name ("Фонари" is a 2026 film *and* the
    "Lanterns" series), so which one a row means is not derivable from the
    title — it is whichever TMDb result the user picked in the add/rename
    search. Callers that resolve a title into a card need that flag or they
    fall back to guessing movie-first. None means the row predates the
    column, or the category does not track it.
    """
    check_table(table)
    async with read_conn() as db:
        async with db.execute(
            f"SELECT is_series FROM {table} WHERE title = ? LIMIT 1", (title,)
        ) as cur:
            row = await cur.fetchone()
    if row is None or row[0] is None:
        return None
    return bool(row[0])


async def item_exists(table: str, title: str) -> bool:
    """Case-insensitive existence check (relies on COLLATE UNICODE_NOCASE on
    the column — see connection.py for why the built-in NOCASE isn't enough)."""
    check_table(table)
    async with read_conn() as db:
        async with db.execute(f"SELECT 1 FROM {table} WHERE title = ? LIMIT 1", (title,)) as cur:
            return await cur.fetchone() is not None


async def item_exists_other_id(table: str, title: str, exclude_id: int) -> bool:
    """Case-insensitive existence check excluding one row by id — for rename
    conflict checks, where the row's own (about-to-be-overwritten) title
    obviously shouldn't count as a conflict with itself."""
    check_table(table)
    async with read_conn() as db:
        async with db.execute(
            f"SELECT 1 FROM {table} WHERE title = ? AND id != ? LIMIT 1", (title, exclude_id)
        ) as cur:
            return await cur.fetchone() is not None


@retry_on_lock
async def add_item(table: str, title: str, is_series: bool | None = None) -> None:
    check_table(table)
    title = title.strip()
    if not title:
        raise ValueError("Title cannot be empty.")
    async with conn() as db:
        async with db.execute(f"SELECT COALESCE(MAX(position), 0) FROM {table}") as cur:
            row = await cur.fetchone()
        next_position = (row[0] if row else 0) + 1
        await db.execute(
            f"INSERT OR IGNORE INTO {table} (title, is_series, position) VALUES (?, ?, ?)",
            (title, None if is_series is None else int(is_series), next_position),
        )
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
async def rename_item_by_id(table: str, item_id: int, new_title: str, is_series: bool | None = None) -> bool:
    """Returns False if item_id no longer exists (e.g. deleted by another
    tab/request in between) rather than silently doing nothing, so the
    caller can tell the difference and surface a real 404. is_series is
    only touched when the caller actually knows it (a fresh TMDb pick) —
    a rename that keeps the typed title as-is (no suggestion picked)
    passes None and leaves whatever was already stored untouched."""
    check_table(table)
    new_title = new_title.strip()
    if not new_title:
        raise ValueError("Title cannot be empty.")
    async with conn() as db:
        if is_series is None:
            cur = await db.execute(f"UPDATE {table} SET title = ? WHERE id = ?", (new_title, item_id))
        else:
            cur = await db.execute(
                f"UPDATE {table} SET title = ?, is_series = ? WHERE id = ?",
                (new_title, int(is_series), item_id),
            )
        await db.commit()
        return cur.rowcount > 0


@retry_on_lock
async def move_item(table: str, item_id: int, direction: str) -> bool:
    """Swap a row's rank with its immediate neighbour in the full list
    (not just the current page — the caller in items.py resolves which
    page the row ends up on afterwards). `direction` is "up" (swap with
    the previous row) or "down" (swap with the next one).

    Reordering here is exactly how a user tunes weighted-roulette odds:
    position IS the weight (see title_weights() in app/services/titles.py),
    so moving a title up simply makes it more likely to be picked.

    Returns False if item_id doesn't exist or is already at that end of
    the list (nothing to swap with)."""
    check_table(table)
    if direction not in ("up", "down"):
        raise ValueError(f"Invalid direction: {direction!r}")
    async with conn() as db:
        async with db.execute(f"SELECT id, position FROM {table} ORDER BY position, id") as cur:
            rows = [(row[0], row[1]) async for row in cur]
        idx = next((i for i, (rid, _) in enumerate(rows) if rid == item_id), None)
        if idx is None:
            return False
        other_idx = idx - 1 if direction == "up" else idx + 1
        if other_idx < 0 or other_idx >= len(rows):
            return False
        (id_a, pos_a), (id_b, pos_b) = rows[idx], rows[other_idx]
        await db.execute(f"UPDATE {table} SET position = ? WHERE id = ?", (pos_b, id_a))
        await db.execute(f"UPDATE {table} SET position = ? WHERE id = ?", (pos_a, id_b))
        await db.commit()
        return True
