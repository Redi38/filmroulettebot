"""Generic per-category item list (movies/cartoons/series/dc/marvel) and
the user's personal tracked-series list."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.db.database import add_item, delete_item, get_items, item_exists
from app.services.tmdb import get_tracked_series_status
from app.utils import paginate

from .shared import CATEGORIES, LIST_PAGE_SIZE, TitleBody, _check_category

router = APIRouter()


@router.get("/api/tracked-series")
async def api_tracked_series() -> dict:
    """The user's personal 'notify me about the next season' list — distinct
    from the Сериалы roulette category, which is about picking something to
    watch now, not tracking a specific show's future releases."""
    titles = await get_items("tracked_series")
    items = await get_tracked_series_status(titles) if titles else []
    return {"items": items}


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


@router.get("/api/{cat}/items")
async def api_items(cat: str, page: int = 1, q: str = "") -> dict:
    _check_category(cat)
    items = await get_items(cat)
    q = q.strip().lower()
    if q:
        items = [i for i in items if q in i.lower()]
    page_items, page, total_pages = paginate(items, page, page_size=LIST_PAGE_SIZE)
    return {"items": page_items, "page": page, "total_pages": total_pages, "total_count": len(items)}


@router.post("/api/{cat}/add")
async def api_add(cat: str, body: TitleBody) -> dict:
    _check_category(cat)
    title = body.title.strip()
    if not title:
        raise HTTPException(400, "Title can't be empty")
    if await item_exists(cat, title):
        raise HTTPException(409, f"«{title}» уже добавлен(а) в «{CATEGORIES.get(cat, cat)}»")
    await add_item(cat, title)
    return {"ok": True}


@router.post("/api/{cat}/delete")
async def api_delete(cat: str, body: TitleBody) -> dict:
    _check_category(cat)
    await delete_item(cat, body.title)
    return {"ok": True}
