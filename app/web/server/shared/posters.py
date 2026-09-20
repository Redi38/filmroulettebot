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

from app.db.database import get_tmdb_cache, get_tmdb_cache_many, set_tmdb_cache
from app.services.tmdb import get_details_by_id, get_movie_info, get_series_info

logger = logging.getLogger(__name__)

FRANCHISE_CATEGORIES = ("dc", "marvel")

_POSTER_CACHE_TTL = 365 * 24 * 3600

_backfill_inflight: set[tuple[str, str]] = set()


async def _cached_poster(cache_key: str) -> dict | None:
    info = await get_tmdb_cache(cache_key, _POSTER_CACHE_TTL)
    return info if (info or {}).get("poster_url") else None


async def lookup_poster_info(cat: str, title: str, is_series: bool | None = None) -> dict | None:
    """Cache-only cached-info dict (poster_url, resolved title, etc.) for
    `title` in category `cat`, or None if it was never resolved elsewhere.

    For dc/marvel, a title can legitimately have both a movie_info and a
    series_info cache entry (e.g. "Фонари" is both a 2026 film and the
    "Lanterns" TV series) — when `is_series` is known (the stored value on
    the item row, set from whichever TMDb result the user actually picked
    in the add-search modal), it decides which cache entry to prefer so
    the poster matches what was picked instead of always guessing movie
    first, which could silently show the wrong title's poster."""
    key = title.strip().lower()
    if cat == "series":
        return await _cached_poster(f"series_info:{key}")
    if cat in FRANCHISE_CATEGORIES:
        if is_series is True:
            return await _cached_poster(f"series_info:{key}") or await _cached_poster(f"movie_info:{key}")
        if is_series is False:
            return await _cached_poster(f"movie_info:{key}") or await _cached_poster(f"series_info:{key}")
        # Legacy row added before is_series was tracked — fall back to the
        # old best-effort guess (movie first).
        return await _cached_poster(f"movie_info:{key}") or await _cached_poster(f"series_info:{key}")
    return await _cached_poster(f"movie_info:{key}")


async def lookup_poster_info_many(
    cat: str, rows: list[tuple[str, bool | None]]
) -> dict[str, dict | None]:
    """Batched counterpart of lookup_poster_info(): resolves a whole page's
    worth of (title, is_series) pairs with one tmdb_cache query instead of
    one (or two, for dc/marvel) per row. Same movie/series preference rule
    as lookup_poster_info — worked out here in Python once the batch of
    cache rows is back, instead of driving it with sequential awaits.

    Returns a dict keyed by the original `title` (not the cache key), so
    callers can just do `result[item["title"]]`.
    """
    if not rows:
        return {}

    keys_needed: set[str] = set()
    for title, is_series in rows:
        key = title.strip().lower()
        if cat == "series":
            keys_needed.add(f"series_info:{key}")
        elif cat in FRANCHISE_CATEGORIES:
            keys_needed.add(f"movie_info:{key}")
            keys_needed.add(f"series_info:{key}")
        else:
            keys_needed.add(f"movie_info:{key}")

    cached = await get_tmdb_cache_many(list(keys_needed), _POSTER_CACHE_TTL)

    out: dict[str, dict | None] = {}
    for title, is_series in rows:
        key = title.strip().lower()
        info = None
        if cat == "series":
            info = cached.get(f"series_info:{key}")
        elif cat in FRANCHISE_CATEGORIES:
            movie_info = cached.get(f"movie_info:{key}")
            series_info = cached.get(f"series_info:{key}")
            if is_series is True:
                info = series_info or movie_info
            elif is_series is False:
                info = movie_info or series_info
            else:
                info = movie_info or series_info
        else:
            info = cached.get(f"movie_info:{key}")
        out[title] = info if (info or {}).get("poster_url") else None
    return out


async def lookup_poster_url(cat: str, title: str, is_series: bool | None = None) -> str | None:
    """Cache-only poster URL for `title` in category `cat`, or None if it
    was never resolved elsewhere."""
    info = await lookup_poster_info(cat, title, is_series)
    return info["poster_url"] if info else None


def schedule_poster_backfill(cat: str, title: str, is_series: bool | None = None) -> None:
    """Fire-and-forget a real TMDb resolve for a title with no cached
    poster, mirroring card_data._fetch_tmdb_info's movie-then-series
    order for dc/marvel (or the known is_series, when the row has one —
    see lookup_poster_info). Never awaited by the caller — callers must
    stay cache-only/fast; this only warms the cache for the *next* load.
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
                if is_series is True:
                    if not await get_series_info(title):
                        await get_movie_info(title)
                elif is_series is False:
                    if not await get_movie_info(title):
                        await get_series_info(title)
                elif not await get_movie_info(title):
                    await get_series_info(title)
            else:
                await get_movie_info(title)
        except Exception:
            logger.warning("poster backfill failed for %r (%s)", title, cat, exc_info=True)
        finally:
            _backfill_inflight.discard(key)

    asyncio.create_task(_run())


async def resolve_wheel_posters(entries: list[tuple[str, str, bool | None]]) -> list[str | None]:
    """Cache-only poster URLs for a wheel's pool, in pool order.

    `entries` is one (cat, title, is_series) triple per segment — duplicates
    allowed, since the same title can sit in two categories (a dc/marvel lot
    resolving to a title that also has its own segment elsewhere). Grouped by
    cat so each category costs one batched tmdb_cache query via
    lookup_poster_info_many, same as the home marquee / list rows.

    Stays cache-only like the rest of this module: a miss gets a background
    schedule_poster_backfill() so the *next* spin has it, and this call
    returns None for that segment instead of waiting on a network lookup.
    """
    if not entries:
        return []
    by_cat: dict[str, list[tuple[str, bool | None]]] = {}
    for cat, title, is_series in entries:
        by_cat.setdefault(cat, []).append((title, is_series))

    resolved: dict[tuple[str, str], str | None] = {}
    for cat, rows in by_cat.items():
        info_by_title = await lookup_poster_info_many(cat, rows)
        for title, is_series in rows:
            info = info_by_title.get(title)
            url = info["poster_url"] if info else None
            resolved[(cat, title)] = url
            if url is None:
                schedule_poster_backfill(cat, title, is_series)

    return [resolved[(cat, title)] for cat, title, _ in entries]


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
