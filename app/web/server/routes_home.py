"""Home screen ('Афиша'): poster set for the 'Твоя коллекция' running
marquee, built entirely from titles already in the user's own lists.

Deliberately cache-only: it never calls the TMDb service functions
(get_movie_info/get_series_info), which would hit the network on a miss.
Instead it reads app.db.database's tmdb_cache table directly, so a title
that was never resolved elsewhere (spin/list/etc.) is simply skipped
rather than triggering a fresh lookup. Posters don't go stale in any
meaningful sense, so the TTL here is generous — this is about maximizing
cache hits, not freshness.
"""
from __future__ import annotations

import random

from fastapi import APIRouter

from app.db.database import get_items, get_tmdb_cache

router = APIRouter()

COLLECTION_CATEGORIES = ("movies", "cartoons", "series")
_POSTER_CACHE_TTL = 365 * 24 * 3600  # posters are effectively static; just want the cache hit
_MAX_POSTERS = 80


@router.get("/api/home/collection")
async def api_home_collection() -> dict:
    pairs: list[tuple[str, str]] = []
    for cat in COLLECTION_CATEGORIES:
        for title in await get_items(cat):
            pairs.append((cat, title))

    total_items = len(pairs)
    random.shuffle(pairs)

    posters: list[dict] = []
    for cat, title in pairs:
        if len(posters) >= _MAX_POSTERS:
            break
        cache_key = f"{'series_info' if cat == 'series' else 'movie_info'}:{title.strip().lower()}"
        info = await get_tmdb_cache(cache_key, _POSTER_CACHE_TTL)
        poster_url = (info or {}).get("poster_url")
        if not poster_url:
            continue
        posters.append({
            "title": (info or {}).get("title") or title,
            "poster_url": poster_url,
            "category": cat,
        })

    return {"posters": posters, "total_items": total_items}
