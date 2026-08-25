"""The user's manually-tracked "upcoming movies" list: add/delete/move and
the digital-release check against TMDb."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.db.database import (
    add_item,
    add_upcoming_movie,
    delete_upcoming_movie,
    get_upcoming_movies,
    item_exists,
    rename_upcoming_movie,
)
from app.services.tmdb import check_upcoming_released

from .shared import MoveBody, RenameBody, TitleBody, _check_category, _validate_rename

router = APIRouter()


@router.get("/api/upcoming")
async def api_upcoming() -> dict:
    items = await get_upcoming_movies()
    return {"items": items}


@router.post("/api/upcoming/add")
async def api_upcoming_add(body: TitleBody) -> dict:
    title = body.title.strip()
    if not title:
        raise HTTPException(400, "Title can't be empty")
    if await item_exists("upcoming_movies", title):
        raise HTTPException(409, f"«{title}» уже в списке ожидаемых")
    await add_upcoming_movie(title)
    return {"ok": True}


@router.post("/api/upcoming/delete")
async def api_upcoming_delete(body: TitleBody) -> dict:
    await delete_upcoming_movie(body.title)
    return {"ok": True}


@router.post("/api/upcoming/rename")
async def api_upcoming_rename(body: RenameBody) -> dict:
    old_title = body.old_title.strip()
    new_title = body.new_title.strip()
    if not await _validate_rename(
        lambda t: item_exists("upcoming_movies", t), old_title, new_title, "",
        conflict_msg=f"«{new_title}» уже в списке ожидаемых",
    ):
        return {"ok": True}
    await rename_upcoming_movie(old_title, new_title)
    return {"ok": True}


@router.post("/api/upcoming/move")
async def api_upcoming_move(body: MoveBody) -> dict:
    _check_category(body.category)
    await add_item(body.category, body.title)
    await delete_upcoming_movie(body.title)
    return {"ok": True}


@router.post("/api/upcoming/check")
async def api_upcoming_check() -> dict:
    items = await get_upcoming_movies()
    if not items:
        return {"released": [], "not_yet": [], "no_info": []}
    return await check_upcoming_released(items)
