"""Shared state, constants, Pydantic bodies, and small helpers used by every
route module in this package. Kept separate from __init__.py so route
modules can import from here without triggering app/router setup."""
from __future__ import annotations

import random
import re
import time
from pathlib import Path
from typing import Any

from fastapi import HTTPException, Request
from pydantic import BaseModel

from app.services.tmdb import get_movie_info, get_series_info
from app.services.watch_link import find_watch_page_url
from app.utils import build_watch_link

LIST_PAGE_SIZE = 30
THEATERS_PAGE_SIZE = 10
NOW_PLAYING_MAX_AGE_DAYS = 90

CATEGORIES = {
    "movies": "Фильмы", "cartoons": "Мультфильмы", "series": "Сериалы",
    "dc": "DC", "marvel": "Marvel",
}
ROULETTE_CATEGORIES = ("movies", "cartoons", "series")

WEB_USER_ID = 0

STATIC_DIR = Path(__file__).parent.parent / "static"

SPIN_COOLDOWN = 1.5  # seconds
WHEEL_POOL_SIZE = 120  # safety cap on wheel segments (perf/readability), winner included
FEATURED_CACHE_TTL = 600  # 10 min

_last_spin_at: dict[str, float] = {}
_last_spin_title: dict[tuple[str, str], str] = {}
_featured_cache: dict[str, tuple[dict, float]] = {}


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


def _pick_title(client_key: str, cat: str, items: list[str]) -> str:
    last = _last_spin_title.get((client_key, cat))
    candidates = [i for i in items if i != last] or items
    title = random.choice(candidates)
    _last_spin_title[(client_key, cat)] = title
    return title


def _build_wheel_pool(items: list[str], winner: str, size: int = WHEEL_POOL_SIZE) -> list[str]:
    """Build the list of titles shown as wheel segments for the front-end's
    roulette-wheel spin animation. Shows the *entire* roulette (all titles,
    winner included) as long as it fits under the safety cap; only samples
    down when the list is unusually large. Keeps the winner's exact position
    hidden from the client until it computes the index itself.
    """
    if len(items) <= size:
        pool = list(items)
        if winner not in pool:
            pool.append(winner)
    else:
        others = [i for i in items if i != winner]
        random.shuffle(others)
        pool = others[: max(size - 1, 0)] + [winner]
    random.shuffle(pool)
    return pool


def _next_sequel_title(item: str) -> str:
    """Same rule the bot uses: "Movie 2" -> "Movie 3", "Movie" -> "Movie 2"."""
    m = re.search(r"(.+?)\s(\d+)$", item)
    return f"{m.group(1)} {int(m.group(2)) + 1}" if m else f"{item} 2"


async def _card_data(cat: str, title: str, history_timestamp: float | None = None) -> dict[str, Any]:
    info = (await get_series_info(title)) if cat == "series" else (await get_movie_info(title))
    info = info or {}
    display_title = info.get("title", title)
    link = await find_watch_page_url(display_title) or build_watch_link(display_title)

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
        "history_timestamp": history_timestamp,
    }


class TitleBody(BaseModel):
    title: str


class MoveBody(BaseModel):
    title: str
    category: str


class SequelBody(BaseModel):
    title: str


class SkipBody(BaseModel):
    scope: str
    title: str


class ResolveBody(BaseModel):
    category: str
    title: str
    timestamp: float
    resolved_type: str
    new_title: str | None = None
