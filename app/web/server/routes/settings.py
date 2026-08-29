"""Shared app-wide settings (not per-browser like the localStorage UI
prefs) — currently just the Афиша local-only filter, but a home for any
future setting that should apply to both of you at once. Distinct from the
theaters/series-releases tabs that happen to be its first consumer — see
theaters.py."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.db.database import get_all_settings, set_setting
from app.db.database.settings import DEFAULTS

from ..shared import SettingBody

router = APIRouter()


@router.get("/api/settings")
async def api_get_settings() -> dict:
    return await get_all_settings()


@router.post("/api/settings/{key}")
async def api_set_setting(key: str, body: SettingBody) -> dict:
    if key not in DEFAULTS:
        raise HTTPException(400, f"Unknown setting: {key!r}")
    await set_setting(key, "1" if body.value else "0")
    return {"ok": True}
