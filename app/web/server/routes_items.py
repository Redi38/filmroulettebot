"""Generic per-category item list (movies/cartoons/series/dc/marvel) and
the user's personal tracked-series list."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.db.database import (
    add_item,
    delete_item,
    delete_item_by_id,
    get_items,
    get_items_with_ids,
    item_exists,
    item_exists_other_id,
    rename_item,
    rename_item_by_id,
)
from app.services.tmdb import (
    get_tracked_series_status,
    search_movie_suggestions,
    search_multi_suggestions,
    search_series_suggestions,
)
from app.utils import paginate

from .shared import (
    CATEGORIES,
    LIST_PAGE_SIZE,
    DeleteByIdBody,
    RenameBody,
    RenameByIdBody,
    TitleBody,
    _check_category,
    _validate_rename,
    _validate_rename_by_id,
)

router = APIRouter()


@router.get("/api/tracked-series")
async def api_tracked_series() -> dict:
    """The user's personal 'notify me about the next season' list — distinct
    from the Сериалы roulette category, which is about picking something to
    watch now, not tracking a specific show's future releases."""
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


@router.get("/api/{cat}/items")
async def api_items(cat: str, page: int = 1, q: str = "") -> dict:
    _check_category(cat)
    items = await get_items_with_ids(cat)
    q = q.strip().lower()
    if q:
        items = [i for i in items if q in i["title"].lower()]
    page_items, page, total_pages = paginate(items, page, page_size=LIST_PAGE_SIZE)
    return {"items": page_items, "page": page, "total_pages": total_pages, "total_count": len(items)}


@router.get("/api/{cat}/search-suggest")
async def api_search_suggest(cat: str, q: str = "") -> dict:
    """TMDb title suggestions for the add-a-title picker: 'series' searches
    /search/tv, movies/cartoons search /search/movie, and dc/marvel search
    both (they cover theatrical films AND streaming series like Loki)."""
    _check_category(cat)
    q = q.strip()
    if not q:
        return {"results": []}
    if cat == "series":
        results = await search_series_suggestions(q)
    elif cat in ("dc", "marvel"):
        results = await search_multi_suggestions(q)
    else:
        results = await search_movie_suggestions(q)
    return {"results": results}


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
async def api_delete(cat: str, body: DeleteByIdBody) -> dict:
    _check_category(cat)
    await delete_item_by_id(cat, body.id)
    return {"ok": True}


@router.post("/api/{cat}/delete-by-title")
async def api_delete_by_title(cat: str, body: TitleBody) -> dict:
    """Title-based counterpart of /delete, for callers that only know a
    title and not a row id — the post-spin 'удалить' flow (pick-actions.js
    -> performDelete) and the history 'удалить' action (history.js) pick a
    title off the wheel pool / a history entry and never see a row id, so
    they can't use the id-based /delete the list UI (list-items.js) uses."""
    _check_category(cat)
    await delete_item(cat, body.title)
    return {"ok": True}


@router.post("/api/{cat}/rename")
async def api_rename(cat: str, body: RenameByIdBody) -> dict:
    _check_category(cat)
    new_title = body.new_title.strip()
    if not await _validate_rename_by_id(
        lambda title, item_id: item_exists_other_id(cat, title, item_id),
        body.id, new_title,
        conflict_msg=f"«{new_title}» уже добавлен(а) в «{CATEGORIES.get(cat, cat)}»",
    ):
        return {"ok": True}
    if not await rename_item_by_id(cat, body.id, new_title):
        raise HTTPException(404, "Тайтл не найден — возможно, уже удалён в другой вкладке")
    return {"ok": True}
