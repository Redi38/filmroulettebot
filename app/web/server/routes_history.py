"""Pick history: recent list and per-category clear."""
from __future__ import annotations

from fastapi import APIRouter

from app.db.database import clear_history_category, get_recent_history

from .shared import _check_category

router = APIRouter()


@router.get("/api/history")
async def api_history(limit: int = 50) -> dict:
    return {"items": await get_recent_history(limit)}


@router.post("/api/history/{cat}/clear")
async def api_history_clear(cat: str) -> dict:
    _check_category(cat)
    await clear_history_category(cat)
    return {"ok": True}
