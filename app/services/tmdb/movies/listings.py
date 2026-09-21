"""TMDb's own theatrical listings (now-playing / upcoming), distinct from
any user-tracked list — used to power the theaters/afisha view."""
from __future__ import annotations

from typing import Any

from app.db.database import get_tmdb_cache, set_tmdb_cache

from ..cache_ttl import DISCOVER_CACHE_TTL
from ..client import _get
from ..helpers import format_movie_results


async def _get_movie_listing(
    endpoint: str, cache_prefix: str, region: str, pages: int
) -> list[dict[str, Any]]:
    """Shared paginated-fetch-then-cache pipeline behind get_now_playing and
    get_upcoming_theatrical: they differ only in which TMDb endpoint to hit
    and what to call the cache entry.

    Fetches several pages (TMDb returns 20/page) rather than just the first —
    a single page leaves too small a pool once the freshness cutoff and any
    skipped titles are filtered out, so a skip has nothing left to backfill
    the page with.
    """
    cache_key = f"{cache_prefix}:{region}:{pages}"
    cached = await get_tmdb_cache(cache_key, DISCOVER_CACHE_TTL)
    if cached is not None:
        return cached
    raw: list[dict[str, Any]] = []
    for page in range(1, pages + 1):
        data = await _get(endpoint, region=region, page=page)
        if not data or not data.get("results"):
            break
        raw.extend(data["results"])
        if page >= (data.get("total_pages") or 1):
            break
    out = format_movie_results(raw)
    await set_tmdb_cache(cache_key, out)
    return out


async def get_now_playing(region: str = "UA", pages: int = 3) -> list[dict[str, Any]]:
    """Movies currently in theaters, per TMDb's own now_playing endpoint."""
    return await _get_movie_listing("/movie/now_playing", "now_playing", region, pages)


async def get_upcoming_theatrical(region: str = "UA", pages: int = 3) -> list[dict[str, Any]]:
    """Movies with an upcoming theatrical release, per TMDb's own upcoming
    endpoint — distinct from the user's own manually-tracked upcoming list
    in the database, this is TMDb's global release calendar."""
    return await _get_movie_listing("/movie/upcoming", "upcoming_theatrical", region, pages)
