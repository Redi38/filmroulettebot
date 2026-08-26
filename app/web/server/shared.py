"""Shared state, constants, Pydantic bodies, and small helpers used by every
route module in this package. Kept separate from __init__.py so route
modules can import from here without triggering app/router setup."""
from __future__ import annotations

import random
import time
from pathlib import Path
from typing import Any

from fastapi import HTTPException, Request
from pydantic import BaseModel

from app.services.card_data import resolve_card_data
from app.services.categories import CATEGORY_LABELS
from app.services.titles import next_sequel_title, pick_title, pick_title_weighted, title_weights

LIST_PAGE_SIZE = 30
THEATERS_PAGE_SIZE = 10
NOW_PLAYING_MAX_AGE_DAYS = 90

CATEGORIES = CATEGORY_LABELS
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


async def _validate_rename(
    exists_fn, old_title: str, new_title: str, category_label: str,
    conflict_msg: str | None = None,
) -> bool:
    """Shared rename validation: empty check, no-op check, existence and
    conflict checks. Returns True if the caller should proceed with the
    rename, False if it's a no-op (old_title == new_title)."""
    if not new_title:
        raise HTTPException(400, "Title can't be empty")
    if new_title == old_title:
        return False
    if not await exists_fn(old_title):
        raise HTTPException(404, f"«{old_title}» не найден(а)")
    if await exists_fn(new_title):
        raise HTTPException(409, conflict_msg or f"«{new_title}» уже добавлен(а) в «{category_label}»")
    return True


def _check_spin_cooldown(client_ip: str) -> None:
    now = time.monotonic()
    elapsed = now - _last_spin_at.get(client_ip, 0.0)
    if elapsed < SPIN_COOLDOWN:
        wait = SPIN_COOLDOWN - elapsed
        raise HTTPException(429, f"Подожди {wait:.1f} сек. перед следующим роллом.")
    _last_spin_at[client_ip] = now


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _pick_title(client_key: str, cat: str, items: list[str], weighted: bool = False) -> str:
    last = _last_spin_title.get((client_key, cat))
    title = pick_title_weighted(items, last) if weighted else pick_title(items, last)
    _last_spin_title[(client_key, cat)] = title
    return title


def _build_wheel_pool(
    items: list[str], winner: str, weighted: bool = False, size: int = WHEEL_POOL_SIZE
) -> tuple[list[str], list[int]]:
    """Build the list of titles (and their relative weights) shown as wheel
    segments for the front-end's roulette-wheel spin animation. Shows the
    *entire* roulette (all titles, winner included) as long as it fits under
    the safety cap; only samples down when the list is unusually large.
    Keeps the winner's exact position hidden from the client until it
    computes the index itself.

    Weights use the same rank rule as pick_title_weighted() (earlier entries
    in the *original* `items` order count for more), so a weighted wheel's
    segment sizes accurately reflect the odds that produced the winner. In
    non-weighted mode every segment gets equal weight, same as before this
    was added.
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

    if weighted:
        weight_map = title_weights(items)
        weights = [weight_map.get(t, 1) for t in pool]
    else:
        weights = [1] * len(pool)
    return pool, weights


async def _card_data(cat: str, title: str, history_timestamp: float | None = None) -> dict[str, Any]:
    data = await resolve_card_data(cat, title)
    info = data["info"]
    display_title = data["title"]
    link = data["watch_link"]

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


class RenameBody(BaseModel):
    old_title: str
    new_title: str


class MoveBody(BaseModel):
    title: str
    category: str


class SequelBody(BaseModel):
    title: str


class SpinBody(BaseModel):
    weighted: bool = False


class SkipBody(BaseModel):
    scope: str
    title: str


class ResolveBody(BaseModel):
    category: str
    title: str
    timestamp: float
    resolved_type: str
    new_title: str | None = None


class DeleteHistoryEntryBody(BaseModel):
    category: str
    title: str
    timestamp: float
