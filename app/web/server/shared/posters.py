"""Cache-only poster URL lookup, shared by the home marquee
(routes/home.py) and the category list rows (routes/items.py).

Reads are deliberately cache-only: they never call the TMDb service
functions (get_movie_info/get_series_info) inline, which would hit the
network and slow down the page. Instead they read app.db.database's
tmdb_cache table directly, so a title that was never resolved elsewhere
(spin/list/showcase/etc.) simply has no poster in that response. Posters
don't go stale in any meaningful sense, so the TTL here is generous —
this is about maximizing cache hits, not freshness.

That cache-only read means a title added straight via "add a title" and
never opened as a card anywhere has genuinely nothing cached yet — most
common for dc/marvel, since each entry there costs up to two lookups
(movie, then series) and both can simply have never happened. schedule_
poster_backfill() self-heals that: on a miss, routes/items.py fires a
real (network) resolve in the background, so the *next* load has it
cached, without making the current request wait on it.
"""
from __future__ import annotations

import asyncio
import logging

from app.db.database import get_tmdb_cache, set_tmdb_cache
from app.services.tmdb import get_details_by_id, get_movie_info, get_series_info

logger = logging.getLogger(__name__)

FRANCHISE_CATEGORIES = ("dc", "marvel")

_POSTER_CACHE_TTL = 365 * 24 * 3600

_backfill_inflight: set[tuple[str, str]] = set()


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


def schedule_poster_backfill(cat: str, title: str) -> None:
    """Fire-and-forget a real TMDb resolve for a title with no cached
    poster, mirroring card_data._fetch_tmdb_info's movie-then-series
    order for dc/marvel. Never awaited by the caller — callers must stay
    cache-only/fast; this only warms the cache for the *next* load.
    Deduplicates so a page of 30 misses (or two tabs open at once)
    doesn't fire the same title's lookup twice concurrently."""
    key = (cat, title.strip().lower())
    if key in _backfill_inflight:
        return
    _backfill_inflight.add(key)

    async def _run() -> None:
        try:
            if cat == "series":
                await get_series_info(title)
            elif cat in FRANCHISE_CATEGORIES:
                if not await get_movie_info(title):
                    await get_series_info(title)
            else:
                await get_movie_info(title)
        except Exception:
            logger.warning("poster backfill failed for %r (%s)", title, cat, exc_info=True)
        finally:
            _backfill_inflight.discard(key)

    asyncio.create_task(_run())


async def cache_info_by_id(title: str, tmdb_id: int, is_series: bool) -> None:
    """Resolve `tmdb_id` (a known, disambiguated match — the exact result
    the user picked in the add-search picker) via get_details_by_id and
    store it under the same title-keyed cache entry get_movie_info/
    get_series_info would, so the poster is correct and available on the
    very next read instead of waiting on a fuzzy title search to guess
    movie vs series (which, for dc/marvel, can genuinely pick the wrong
    one when a franchise has both a film and a show with the same title).
    """
    info = await get_details_by_id(tmdb_id, is_series)
    if not info:
        return
    cache_key = f"{'series' if is_series else 'movie'}_info:{title.strip().lower()}"
    await set_tmdb_cache(cache_key, info)
