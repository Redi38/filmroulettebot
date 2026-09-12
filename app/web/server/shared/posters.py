"""Cache-only poster URL lookup, shared by the home marquee
(routes/home.py) and the category list rows (routes/items.py).

Deliberately cache-only: it never calls the TMDb service functions
(get_movie_info/get_series_info), which would hit the network on a miss.
Instead it reads app.db.database's tmdb_cache table directly, so a title
that was never resolved elsewhere (spin/list/showcase/etc.) simply has no
poster rather than triggering a fresh lookup. Posters don't go stale in
any meaningful sense, so the TTL here is generous — this is about
maximizing cache hits, not freshness.
"""
from __future__ import annotations

from app.db.database import get_tmdb_cache

FRANCHISE_CATEGORIES = ("dc", "marvel")

_POSTER_CACHE_TTL = 365 * 24 * 3600


async def _cached_poster(cache_key: str) -> dict | None:
    info = await get_tmdb_cache(cache_key, _POSTER_CACHE_TTL)
    return info if (info or {}).get("poster_url") else None


async def lookup_poster_info(cat: str, title: str) -> dict | None:
    """Cache-only cached-info dict (poster_url, resolved title, etc.) for
    `title` in category `cat`, or None if it was never resolved elsewhere."""
    key = title.strip().lower()
    if cat == "series":
        return await _cached_poster(f"series_info:{key}")
    if cat in FRANCHISE_CATEGORIES:
        return await _cached_poster(f"movie_info:{key}") or await _cached_poster(f"series_info:{key}")
    return await _cached_poster(f"movie_info:{key}")


async def lookup_poster_url(cat: str, title: str) -> str | None:
    """Cache-only poster URL for `title` in category `cat`, or None if it
    was never resolved elsewhere."""
    info = await lookup_poster_info(cat, title)
    return info["poster_url"] if info else None
