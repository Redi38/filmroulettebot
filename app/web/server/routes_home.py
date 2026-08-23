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

from fastapi import APIRouter

from app.db.database import get_items, get_tmdb_cache

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
            "poster_url": info["poster_url"],
            "category": cat,
        })

    return {"posters": posters, "total_items": total_items}
