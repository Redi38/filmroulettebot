"""Generic shared app-wide settings (key/value). Unlike history, these are
*not* per-user — the site is used by a small shared household, so a toggle
like "hide local-only Афиша titles" is meant to apply to everyone at once,
not per browser/device like the localStorage-based UI prefs (sound theme,
mute, confetti) are today."""
from __future__ import annotations

from .connection import conn, retry_on_lock

DEFAULTS: dict[str, str] = {
    "hide_local_only_afisha": "0",
}


@retry_on_lock
async def get_setting(key: str, default: str | None = None) -> str:
    fallback = DEFAULTS.get(key, "0") if default is None else default
    async with conn() as db:
        async with db.execute(
            "SELECT value FROM app_settings WHERE key = ?", (key,)
        ) as cur:
            row = await cur.fetchone()
    return row[0] if row is not None else fallback


@retry_on_lock
async def get_bool_setting(key: str) -> bool:
    value = await get_setting(key)
    return value == "1"


@retry_on_lock
async def set_setting(key: str, value: str) -> None:
    async with conn() as db:
        await db.execute(
            "INSERT INTO app_settings (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, value),
        )
        await db.commit()


@retry_on_lock
async def get_all_settings() -> dict[str, str]:
    """All known settings with their current values (defaults filled in for
    rows that don't exist yet) — used by the /api/settings GET endpoint."""
    async with conn() as db:
        async with db.execute("SELECT key, value FROM app_settings") as cur:
            stored = {row[0]: row[1] async for row in cur}
    return {key: stored.get(key, default) for key, default in DEFAULTS.items()}
