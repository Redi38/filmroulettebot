"""Web version of the roulette: FastAPI backend reusing the exact same
database layer, TMDb service, and kinogo-link resolver the Telegram bot
uses. No auth by design (keep the URL private) — see README for the
docker-compose service that runs this alongside the bot, sharing the SQLite
file over a volume.
"""
from __future__ import annotations

import logging
import random
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from app.db.database import (
    init_db, get_items, add_item, delete_item, item_exists,
    get_upcoming_movies, add_upcoming_movie, delete_upcoming_movie,
)
from app.services.tmdb import get_movie_info, get_series_info, check_upcoming_released
from app.services.watch_link import find_watch_page_url

logger = logging.getLogger(__name__)

CATEGORIES = {
    "movies": "Фильмы", "cartoons": "Мультфильмы", "series": "Сериалы",
    "dc": "DC", "marvel": "Marvel",
}

STATIC_DIR = Path(__file__).parent / "static"

app = FastAPI(title="Filmroulette Web")


@app.on_event("startup")
async def _startup() -> None:
    await init_db()


def _check_category(cat: str) -> None:
    if cat not in CATEGORIES:
        raise HTTPException(404, f"Unknown category: {cat}")


class TitleBody(BaseModel):
    title: str


class MoveBody(BaseModel):
    title: str
    category: str


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/api/categories")
async def api_categories() -> dict:
    out = {}
    for code, ru in CATEGORIES.items():
        items = await get_items(code)
        out[code] = {"label": ru, "count": len(items)}
    return out


# ─── Upcoming routes — must be registered BEFORE the generic /api/{cat}/*
# routes below, otherwise Starlette matches "/api/upcoming/add" against the
# "/api/{cat}/add" pattern first (cat="upcoming"), which then 404s since
# "upcoming" isn't in CATEGORIES. Route order matters in FastAPI/Starlette.
@app.get("/api/upcoming")
async def api_upcoming() -> dict:
    items = await get_upcoming_movies()
    return {"items": items}


@app.post("/api/upcoming/add")
async def api_upcoming_add(body: TitleBody) -> dict:
    title = body.title.strip()
    if not title:
        raise HTTPException(400, "Title can't be empty")
    if await item_exists("upcoming_movies", title):
        raise HTTPException(409, f"«{title}» already in upcoming")
    await add_upcoming_movie(title)
    return {"ok": True}


@app.post("/api/upcoming/delete")
async def api_upcoming_delete(body: TitleBody) -> dict:
    await delete_upcoming_movie(body.title)
    return {"ok": True}


@app.post("/api/upcoming/move")
async def api_upcoming_move(body: MoveBody) -> dict:
    _check_category(body.category)
    await add_item(body.category, body.title)
    await delete_upcoming_movie(body.title)
    return {"ok": True}


@app.post("/api/upcoming/check")
async def api_upcoming_check() -> dict:
    items = await get_upcoming_movies()
    if not items:
        return {"released": [], "not_yet": [], "no_info": []}
    return await check_upcoming_released(items)


# ─── Generic per-category routes ────────────────────────────────────────────
@app.get("/api/{cat}/items")
async def api_items(cat: str) -> dict:
    _check_category(cat)
    items = await get_items(cat)
    return {"items": items}


@app.post("/api/{cat}/add")
async def api_add(cat: str, body: TitleBody) -> dict:
    _check_category(cat)
    title = body.title.strip()
    if not title:
        raise HTTPException(400, "Title can't be empty")
    if await item_exists(cat, title):
        raise HTTPException(409, f"«{title}» already in {cat}")
    await add_item(cat, title)
    return {"ok": True}


@app.post("/api/{cat}/delete")
async def api_delete(cat: str, body: TitleBody) -> dict:
    _check_category(cat)
    await delete_item(cat, body.title)
    return {"ok": True}


@app.post("/api/{cat}/spin")
async def api_spin(cat: str) -> dict:
    _check_category(cat)
    items = await get_items(cat)
    if not items:
        raise HTTPException(404, "List is empty")
    title = random.choice(items)

    info = (await get_series_info(title)) if cat == "series" else (await get_movie_info(title))
    info = info or {}
    display_title = info.get("title", title)
    link = await find_watch_page_url(display_title)

    rating = info.get("rating", "—")
    if isinstance(rating, (int, float)):
        # Подстраховка: если пришло значение из кэша до фикса с округлением.
        rating = round(rating, 1)

    return {
        "title": display_title,
        "original_title": title,
        "overview": info.get("overview", ""),
        "release_date": info.get("release_date", "—"),
        "rating": rating,
        "genres": info.get("genres", "—"),
        "actors": info.get("actors", "—"),
        "runtime": info.get("runtime"),
        "seasons": info.get("seasons"),
        "episodes": info.get("episodes"),
        "poster_url": info.get("poster_url"),
        "watch_link": link,
    }


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
