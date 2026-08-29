"""The user's personal 'notify me about the next season' list — distinct
from the Сериалы roulette category, which is about picking something to
watch now, not tracking a specific show's future releases."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.db.database import add_item, delete_item, get_items, item_exists, rename_item
from app.services.tmdb import get_tracked_series_status, search_series_suggestions

from ..shared import RenameBody, TitleBody, _validate_rename

router = APIRouter()


@router.get("/api/tracked-series")
async def api_tracked_series() -> dict:
    titles = await get_items("tracked_series")
    items = await get_tracked_series_status(titles) if titles else []
    return {"items": items}


@router.get("/api/tracked-series/search-suggest")
async def api_tracked_series_search_suggest(q: str = "") -> dict:
    q = q.strip()
    return {"results": (await search_series_suggestions(q)) if q else []}


@router.post("/api/tracked-series/add")
async def api_tracked_series_add(body: TitleBody) -> dict:
    title = body.title.strip()
    if not title:
        raise HTTPException(400, "Title can't be empty")
    if await item_exists("tracked_series", title):
        raise HTTPException(409, f"«{title}» уже отслеживается")
    await add_item("tracked_series", title)
    return {"ok": True}


@router.post("/api/tracked-series/delete")
async def api_tracked_series_delete(body: TitleBody) -> dict:
    await delete_item("tracked_series", body.title)
    return {"ok": True}


@router.post("/api/tracked-series/rename")
async def api_tracked_series_rename(body: RenameBody) -> dict:
    old_title = body.old_title.strip()
    new_title = body.new_title.strip()
    if not await _validate_rename(
        lambda t: item_exists("tracked_series", t), old_title, new_title, "",
        conflict_msg=f"«{new_title}» уже отслеживается",
    ):
        return {"ok": True}
    await rename_item("tracked_series", old_title, new_title)
    return {"ok": True}
