"""Pick history (per-user and global-recent for the web UI) plus the
per-category roll stats used by the bot's /stats command."""
from __future__ import annotations

import time
from typing import Any

from app.config import settings

from .connection import conn, retry_on_lock


async def load_history(user_id: int, category: str | None = None) -> list[dict[str, Any]]:
    query = (
        "SELECT category, title, timestamp FROM history "
        "WHERE user_id = ? AND category = ? ORDER BY timestamp DESC"
        if category
        else "SELECT category, title, timestamp FROM history "
             "WHERE user_id = ? ORDER BY timestamp DESC"
    )
    params: tuple[Any, ...] = (user_id, category) if category else (user_id,)
    async with conn() as db:
        async with db.execute(query, params) as cur:
            return [
                {"category": row[0], "title": row[1], "timestamp": row[2]}
                async for row in cur
            ]


async def get_recent_history(limit: int = 50) -> list[dict[str, Any]]:
    """History across ALL users (no user_id filter) — used by the web UI,
    which has no login/user concept by design (personal-use, no-auth site).
    Newest first. Includes server-side resolved state (confirmed/sequel/
    deleted) so that "Подтвердить" correctly disappears for everyone once
    any device has resolved a pick — not just the device that resolved it."""
    async with conn() as db:
        async with db.execute(
            "SELECT category, title, timestamp, resolved_type, resolved_new_title "
            "FROM history ORDER BY timestamp DESC LIMIT ?",
            (limit,),
        ) as cur:
            return [
                {
                    "category": row[0],
                    "title": row[1],
                    "timestamp": row[2],
                    "resolved_type": row[3],
                    "resolved_new_title": row[4],
                }
                async for row in cur
            ]


@retry_on_lock
async def save_history(user_id: int, category: str, title: str) -> float:
    film_cats = ("movies", "cartoons")
    limit = settings.HISTORY_CLEAR_LIMIT

    async with conn() as db:
        if category in film_cats:
            async with db.execute(
                "SELECT COUNT(*) FROM history WHERE user_id = ? AND category IN (?,?)",
                (user_id, *film_cats),
            ) as cur:
                row = await cur.fetchone()
                count = row[0] if row else 0
        else:
            async with db.execute(
                "SELECT COUNT(*) FROM history WHERE user_id = ? AND category = ?",
                (user_id, category),
            ) as cur:
                row = await cur.fetchone()
                count = row[0] if row else 0

        if count >= limit:
            excess = count - limit + 1
            if category in film_cats:
                await db.execute(
                    "DELETE FROM history WHERE id IN ("
                    "  SELECT id FROM history WHERE user_id = ? AND category IN (?,?)"
                    "  ORDER BY timestamp ASC LIMIT ?"
                    ")",
                    (user_id, *film_cats, excess),
                )
            else:
                await db.execute(
                    "DELETE FROM history WHERE id IN ("
                    "  SELECT id FROM history WHERE user_id = ? AND category = ?"
                    "  ORDER BY timestamp ASC LIMIT ?"
                    ")",
                    (user_id, category, excess),
                )

        ts = time.time()
        await db.execute(
            "INSERT INTO history (user_id, category, title, timestamp) VALUES (?,?,?,?)",
            (user_id, category, title, ts),
        )
        await db.commit()
        return ts


@retry_on_lock
async def resolve_history_entry(
    category: str, title: str, timestamp: float, resolved_type: str, new_title: str | None = None
) -> bool:
    """Mark a specific history pick as resolved (confirmed/sequel/deleted) on
    the server, so every device sees the same state — previously this lived
    only in each browser's localStorage, so a pick confirmed on one device
    still showed a stale "Подтвердить" button (for a title that no longer
    exists) on every other device. Matches on (category, title, timestamp)
    since that's the same triple the client already uses as its dedup key.
    Returns False if no matching row was found (e.g. timestamp mismatch)."""
    async with conn() as db:
        cur = await db.execute(
            "UPDATE history SET resolved_type = ?, resolved_new_title = ? "
            "WHERE category = ? AND title = ? AND timestamp = ?",
            (resolved_type, new_title, category, title, timestamp),
        )
        await db.commit()
        return cur.rowcount > 0


@retry_on_lock
async def clear_user_history(user_id: int) -> None:
    async with conn() as db:
        await db.execute("DELETE FROM history WHERE user_id = ?", (user_id,))
        await db.commit()


@retry_on_lock
async def clear_all_history() -> None:
    async with conn() as db:
        await db.execute("DELETE FROM history")
        await db.commit()


@retry_on_lock
async def clear_history_category(category: str) -> None:
    async with conn() as db:
        await db.execute("DELETE FROM history WHERE category = ?", (category,))
        await db.commit()


@retry_on_lock
async def delete_history_entry(category: str, title: str, timestamp: float) -> bool:
    """Remove a single history pick (identified the same way resolve_history_entry
    matches one: category + title + timestamp), leaving the rest of the category's
    history and the title's list membership untouched. Returns False if no matching
    row was found."""
    async with conn() as db:
        cur = await db.execute(
            "DELETE FROM history WHERE category = ? AND title = ? AND timestamp = ?",
            (category, title, timestamp),
        )
        await db.commit()
        return cur.rowcount > 0
