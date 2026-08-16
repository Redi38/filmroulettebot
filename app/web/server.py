"""Web version of the roulette: FastAPI backend reusing the exact same
database layer, TMDb service, and kinogo-link resolver the Telegram bot
uses. No auth by design (keep the URL private) — see docker-compose.yml
for the service that runs this alongside the bot, sharing the SQLite file
over a volume.
"""
from __future__ import annotations

import logging
import random
import re
import time
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from app.db.database import (
    init_db, get_items, add_item, delete_item, item_exists,
    get_upcoming_movies, add_upcoming_movie, delete_upcoming_movie,
    save_history, get_recent_history,
)
from app.services.tmdb import get_movie_info, get_series_info, check_upcoming_released
from app.services.watch_link import find_watch_page_url
from app.utils import paginate

logger = logging.getLogger(__name__)

LIST_PAGE_SIZE = 30

_last_spin_at: dict[str, float] = {}
SPIN_COOLDOWN = 1.5  # seconds

_featured_cache: dict[str, tuple[dict, float]] = {}
FEATURED_CACHE_TTL = 600  # 10 min

CATEGORIES = {
    "movies": "Фильмы", "cartoons": "Мультфильмы", "series": "Сериалы",
    "dc": "DC", "marvel": "Marvel",
}
ROULETTE_CATEGORIES = ("movies", "cartoons", "series")

WEB_USER_ID = 0

STATIC_DIR = Path(__file__).parent / "static"

app = FastAPI(title="Filmroulette Web")


@app.on_event("startup")
async def _startup() -> None:
    await init_db()


def _check_category(cat: str) -> None:
    if cat not in CATEGORIES:
        raise HTTPException(404, f"Unknown category: {cat}")


def _check_spin_cooldown(client_ip: str) -> None:
    now = time.monotonic()
    elapsed = now - _last_spin_at.get(client_ip, 0.0)
    if elapsed < SPIN_COOLDOWN:
        wait = SPIN_COOLDOWN - elapsed
        raise HTTPException(429, f"Подожди {wait:.1f} сек. перед следующим роллом.")
    _last_spin_at[client_ip] = now


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _next_sequel_title(item: str) -> str:
    """Same rule the bot uses: "Movie 2" -> "Movie 3", "Movie" -> "Movie 2"."""
    m = re.search(r"(.+?)\s(\d+)$", item)
    return f"{m.group(1)} {int(m.group(2)) + 1}" if m else f"{item} 2"


async def _card_data(cat: str, title: str) -> dict[str, Any]:
    info = (await get_series_info(title)) if cat == "series" else (await get_movie_info(title))
    info = info or {}
    display_title = info.get("title", title)
    link = await find_watch_page_url(display_title)

    rating = info.get("rating", "—")
    if isinstance(rating, (int, float)):
        rating = round(rating, 1)

    return {
        "category": cat,
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


class TitleBody(BaseModel):
    title: str


class MoveBody(BaseModel):
    title: str
    category: str


class SequelBody(BaseModel):
    title: str


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


# ─── History ────────────────────────────────────────────────────────────────
@app.get("/api/history")
async def api_history(limit: int = 50) -> dict:
    return {"items": await get_recent_history(limit)}


# ─── Random spin across movies/cartoons/series ──────────────────────────────
@app.post("/api/random-spin")
async def api_random_spin(request: Request) -> dict:
    _check_spin_cooldown(_client_ip(request))
    non_empty = [c for c in ROULETTE_CATEGORIES if await get_items(c)]
    if not non_empty:
        raise HTTPException(404, "All three roulettes are empty")
    cat = random.choice(non_empty)
    items = await get_items(cat)
    title = random.choice(items)
    await save_history(WEB_USER_ID, cat, title)
    return await _card_data(cat, title)


# ─── Upcoming routes —───────────────────────────────────────────────────────
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
async def api_items(cat: str, page: int = 1, q: str = "") -> dict:
    _check_category(cat)
    items = await get_items(cat)
    q = q.strip().lower()
    if q:
        items = [i for i in items if q in i.lower()]
    page_items, page, total_pages = paginate(items, page, page_size=LIST_PAGE_SIZE)
    return {"items": page_items, "page": page, "total_pages": total_pages, "total_count": len(items)}


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
async def api_spin(cat: str, request: Request) -> dict:
    _check_category(cat)
    if cat not in ROULETTE_CATEGORIES:
        raise HTTPException(400, f"{cat} has no roulette — it's a reference list only")
    _check_spin_cooldown(_client_ip(request))
    items = await get_items(cat)
    if not items:
        raise HTTPException(404, "List is empty")
    title = random.choice(items)
    await save_history(WEB_USER_ID, cat, title)
    return await _card_data(cat, title)


@app.get("/api/{cat}/featured")
async def api_featured(cat: str) -> dict:
    """Full card (poster, description, rating, kinogo link — same as a spin
    result) for the FIRST title in the list. Used for DC/Marvel, which have
    no real roulette by design (reference lists only) — this is a
    deterministic "showcase" stand-in, not a random pick, so unlike /spin
    it does NOT write to history, and unlike /spin it IS cached (same input
    -> same output every time, so no point re-hitting TMDB+kinogo often)."""
    _check_category(cat)
    items = await get_items(cat)
    if not items:
        raise HTTPException(404, "List is empty")
    first = items[0]

    cache_key = f"{cat}:{first}"
    cached = _featured_cache.get(cache_key)
    if cached is not None:
        data, expires_at = cached
        if time.monotonic() < expires_at:
            return data
        del _featured_cache[cache_key]

    data = await _card_data(cat, first)
    _featured_cache[cache_key] = (data, time.monotonic() + FEATURED_CACHE_TTL)
    return data



@app.post("/api/{cat}/sequel")
async def api_sequel(cat: str, body: SequelBody) -> dict:
    """Confirm-with-sequel: rename "Title" -> "Title 2" (or bump the number),
    same rule the bot's "✅ Да, сиквел" button uses."""
    _check_category(cat)
    item = body.title
    new_item = _next_sequel_title(item)
    await delete_item(cat, item)
    await add_item(cat, new_item)
    return {"ok": True, "new_title": new_item}


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
