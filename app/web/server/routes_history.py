"""Pick history: recent list, per-entry delete, and per-category clear."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.db.database import (
    clear_history_category,
    delete_history_entry,
    get_recent_history,
    resolve_history_entry,
)

from .shared import DeleteHistoryEntryBody, ResolveBody, _check_category

router = APIRouter()


@router.get("/api/history")
async def api_history(limit: int = 50) -> dict:
    return {"items": await get_recent_history(limit)}


@router.post("/api/history/resolve")
async def api_history_resolve(body: ResolveBody) -> dict:
    """Persist that a history pick was confirmed/turned into a sequel/deleted,
    so the "Подтвердить" button disappears for every device — not just the
    one that resolved it (previously tracked only in that browser's
    localStorage)."""
    ok = await resolve_history_entry(
        body.category, body.title, body.timestamp, body.resolved_type, body.new_title
    )
    if not ok:
        raise HTTPException(404, "History entry not found")
    return {"ok": True}


@router.post("/api/history/delete")
async def api_history_delete_entry(body: DeleteHistoryEntryBody) -> dict:
    """Remove one history pick (the per-item 'Очистить' button) without
    touching the title's list membership or the rest of the category's
    history — distinct from /api/history/{cat}/clear, which wipes the
    whole category."""
    _check_category(body.category)
    ok = await delete_history_entry(body.category, body.title, body.timestamp)
    if not ok:
        raise HTTPException(404, "History entry not found")
    return {"ok": True}


@router.post("/api/history/{cat}/clear")
async def api_history_clear(cat: str) -> dict:
    _check_category(cat)
    await clear_history_category(cat)
    return {"ok": True}
