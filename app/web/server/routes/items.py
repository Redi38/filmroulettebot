"""Generic per-category item list (movies/cartoons/series/dc/marvel):
listing, search-suggest, add, delete, and rename. The user's personal
tracked-series list is a related but distinct concern — see
tracked_series.py."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from app.db.database import (
    add_item,
    delete_item,
    delete_item_by_id,
    get_items_with_ids,
    item_exists,
    item_exists_other_id,
    move_item,
    rename_item_by_id,
)
from app.services.tmdb import (
    search_movie_suggestions,
    search_multi_suggestions,
    search_series_suggestions,
)
from app.utils import paginate

from ..shared.bodies import DeleteByIdBody, RenameByIdBody, ReorderBody, TitleBody
from ..shared.constants import CATEGORIES, LIST_PAGE_SIZE
from ..shared.posters import cache_info_by_id, lookup_poster_info_many, schedule_poster_backfill
from ..shared.validation import add_or_conflict, valid_category, validate_rename_by_id

router = APIRouter()


@router.get("/api/{cat}/items")
async def api_items(cat: str = Depends(valid_category), page: int = 1, q: str = "") -> dict:
    items = await get_items_with_ids(cat)
    q = q.strip().lower()
    if q:
        items = [i for i in items if q in i["title"].lower()]
    page_items, page, total_pages = paginate(items, page, page_size=LIST_PAGE_SIZE)
    # One batched tmdb_cache lookup for the whole page instead of one (or
    # two, for dc/marvel) awaited SELECT per row — each of which serialises
    # on the shared connection's lock, so a page of 30 rows used to mean
    # 30-60 sequential round trips.
    is_series_by_title = {item["title"]: item.pop("is_series", None) for item in page_items}
    poster_by_title = await lookup_poster_info_many(cat, list(is_series_by_title.items()))
    for item in page_items:
        info = poster_by_title.get(item["title"])
        item["poster_url"] = info["poster_url"] if info else None
        if not item["poster_url"]:
            schedule_poster_backfill(cat, item["title"], is_series_by_title[item["title"]])
    return {"items": page_items, "page": page, "total_pages": total_pages, "total_count": len(items)}


@router.get("/api/{cat}/search-suggest")
async def api_search_suggest(cat: str = Depends(valid_category), q: str = "") -> dict:
    """TMDb title suggestions for the add-a-title picker: 'series' searches
    /search/tv, movies/cartoons search /search/movie, and dc/marvel search
    both (they cover theatrical films AND streaming series like Loki)."""
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
async def api_add(body: TitleBody, cat: str = Depends(valid_category)) -> dict:
    title = await add_or_conflict(
        lambda t: item_exists(cat, t),
        lambda t: add_item(cat, t, body.is_series),
        body.title,
        conflict_msg=f"Не добавлено — «{body.title.strip()}» уже есть в «{CATEGORIES.get(cat, cat)}»",
    )
    if body.tmdb_id is not None:
        await cache_info_by_id(title, body.tmdb_id, bool(body.is_series))
    return {"ok": True}


@router.post("/api/{cat}/delete")
async def api_delete(body: DeleteByIdBody, cat: str = Depends(valid_category)) -> dict:
    await delete_item_by_id(cat, body.id)
    return {"ok": True}


@router.post("/api/{cat}/reorder")
async def api_reorder(body: ReorderBody, cat: str = Depends(valid_category)) -> dict:
    """Swap a title's rank with its neighbour above/below — in the full
    list, across page boundaries, not just the current page of /items.
    Position doubles as the weighted-roulette weight (see title_weights()
    in app/services/titles.py), so this is how a user makes a title more
    or less likely to come up."""
    if body.direction not in ("up", "down"):
        raise HTTPException(400, "direction must be 'up' or 'down'")
    if not await move_item(cat, body.id, body.direction):
        raise HTTPException(409, "Уже с краю списка — дальше двигать некуда")
    return {"ok": True}


@router.post("/api/{cat}/delete-by-title")
async def api_delete_by_title(body: TitleBody, cat: str = Depends(valid_category)) -> dict:
    """Title-based counterpart of /delete, for callers that only know a
    title and not a row id — the post-spin 'удалить' flow (pick-actions.js
    -> performDelete) and the history 'удалить' action (history.js) pick a
    title off the wheel pool / a history entry and never see a row id, so
    they can't use the id-based /delete the list UI (list-items.js) uses."""
    await delete_item(cat, body.title)
    return {"ok": True}


@router.post("/api/{cat}/rename")
async def api_rename(body: RenameByIdBody, cat: str = Depends(valid_category)) -> dict:
    new_title = body.new_title.strip()
    if not await validate_rename_by_id(
        lambda title, item_id: item_exists_other_id(cat, title, item_id),
        body.id, new_title,
        conflict_msg=f"Не изменено — «{new_title}» уже есть в «{CATEGORIES.get(cat, cat)}»",
    ):
        return {"ok": True}
    if not await rename_item_by_id(cat, body.id, new_title, body.is_series):
        raise HTTPException(404, "Тайтл не найден — возможно, уже удалён в другой вкладке")
    if body.tmdb_id is not None:
        await cache_info_by_id(new_title, body.tmdb_id, bool(body.is_series))
    return {"ok": True}
