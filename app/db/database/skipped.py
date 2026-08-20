"""Per-scope "not interested" list for the global-discovery tabs (Афиша /
Премьеры сериалов), which show TMDb data rather than the user's own lists."""
from __future__ import annotations

from .connection import conn, retry_on_lock

SKIP_SCOPES = frozenset({"theaters_now_playing", "theaters_upcoming", "series_releases"})


def _check_skip_scope(scope: str) -> None:
    if scope not in SKIP_SCOPES:
        raise ValueError(f"Unknown skip scope: {scope!r}")


@retry_on_lock
async def get_skipped(scope: str) -> list[str]:
    _check_skip_scope(scope)
    async with conn() as db:
        async with db.execute(
            "SELECT title FROM skipped_titles WHERE scope = ?", (scope,)
        ) as cur:
            return [row[0] async for row in cur]


@retry_on_lock
async def add_skipped(scope: str, title: str) -> None:
    _check_skip_scope(scope)
    async with conn() as db:
        await db.execute(
            "INSERT OR IGNORE INTO skipped_titles (scope, title) VALUES (?, ?)",
            (scope, title),
        )
        await db.commit()


@retry_on_lock
async def remove_skipped(scope: str, title: str) -> None:
    _check_skip_scope(scope)
    async with conn() as db:
        await db.execute(
            "DELETE FROM skipped_titles WHERE scope = ? AND title = ? COLLATE NOCASE",
            (scope, title),
        )
        await db.commit()
