"""Home screen ('Афиша'): poster set for the 'Твоя коллекция' running
marquee, built entirely from titles already in the user's own lists.

Deliberately cache-only: it never calls the TMDb service functions
(get_movie_info/get_series_info), which would hit the network on a miss.
Instead it reads app.db.database's tmdb_cache table directly, so a title
that was never resolved elsewhere (spin/list/showcase/etc.) is simply
skipped rather than triggering a fresh lookup. Posters don't go stale in
any meaningful sense, so the TTL here is generous — this is about
maximizing cache hits, not freshness.
"""
from __future__ import annotations

import random

from fastapi import APIRouter, HTTPException

from app.db.database import get_items, get_tmdb_cache, item_exists

from .shared import _card_data, _check_category

router = APIRouter()

COLLECTION_CATEGORIES = ("movies", "cartoons", "series")
FRANCHISE_CATEGORIES = ("dc", "marvel")

_POSTER_CACHE_TTL = 365 * 24 * 3600
_MAX_POSTERS = 80


async def _cached_poster(cache_key: str) -> dict | None:
    info = await get_tmdb_cache(cache_key, _POSTER_CACHE_TTL)
    return info if (info or {}).get("poster_url") else None


async def _lookup_poster(cat: str, title: str) -> dict | None:
    key = title.strip().lower()
    if cat == "series":
        return await _cached_poster(f"series_info:{key}")
    if cat in FRANCHISE_CATEGORIES:
        info = await _cached_poster(f"movie_info:{key}")
        return info or await _cached_poster(f"series_info:{key}")
    return await _cached_poster(f"movie_info:{key}")


@router.get("/api/home/collection")
async def api_home_collection() -> dict:
    pairs: list[tuple[str, str]] = []
    for cat in (*COLLECTION_CATEGORIES, *FRANCHISE_CATEGORIES):
        for title in await get_items(cat):
            pairs.append((cat, title))

    total_items = len(pairs)
    random.shuffle(pairs)

    posters: list[dict] = []
    for cat, title in pairs:
        if len(posters) >= _MAX_POSTERS:
            break
        info = await _lookup_poster(cat, title)
        if not info:
            continue
        posters.append({
            "title": info.get("title") or title,
            "original_title": title,
            "poster_url": info["poster_url"],
            "category": cat,
        })

    return {"posters": posters, "total_items": total_items}


@router.get("/api/home/card")
async def api_home_card(category: str, title: str) -> dict:
    """Full card info for a poster tapped in the 'Афиша' marquee — same
    shape as the spin/list-featured cards, minus spin actions (the poster
    is just something the user already has in a list, not a fresh pick).
    `title` here must be the raw title as stored in the DB (the marquee's
    `original_title`), not the TMDb-resolved display title — those can
    differ (translated/alternate titles) and item_exists checks the raw
    table."""
    _check_category(category)
    if not await item_exists(category, title):
        raise HTTPException(404, "Title not found in this category")
    return await _card_data(category, title)
