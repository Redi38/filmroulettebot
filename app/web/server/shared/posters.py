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

from app.db.database import delete_tmdb_cache, get_tmdb_cache, get_tmdb_cache_many, set_tmdb_cache
from app.services.tmdb import get_details_by_id, get_movie_info, get_series_info
from app.services.tmdb.media_search import MediaType, search_cache_key, search_completed

logger = logging.getLogger(__name__)

FRANCHISE_CATEGORIES = ("dc", "marvel")

# tmdb_cache key prefixes: get_movie_info / get_series_info store under these.
_MOVIE = "movie_info"
_SERIES = "series_info"

_POSTER_CACHE_TTL = 365 * 24 * 3600

# "TMDb has nothing for this title" marker, written by the background backfill
# when TMDb answered but there is no match at all (get_movie_info/get_series_info
# return None and cache nothing, so without this a title that simply isn't on
# TMDb is indistinguishable from one that was never looked up). A title whose
# TMDb match exists but carries no poster needs no marker: that info is cached
# with poster_url None. Short TTL, since TMDb often gains a poster or an entry
# later (especially for upcoming films).
_MISS = "poster_miss"
_MISS_TTL = 7 * 24 * 3600

# search_completed() takes the media type the TMDb search endpoints use.
_SEARCH_TYPE: dict[str, MediaType] = {_MOVIE: "movie", _SERIES: "tv"}

_backfill_inflight: set[tuple[str, str]] = set()
# The event loop only keeps a weak reference to a running task, so a
# fire-and-forget create_task() whose result nobody holds can be garbage-
# collected mid-flight (documented asyncio behaviour). Hold them here until done.
_backfill_tasks: set[asyncio.Task] = set()

# The cached poster_url is the w500 one built for the big result card, but a
# wheel segment is a thin wedge — see helpers.POSTER_LARGE vs POSTER_CARD. A
# wheel can carry 40+ posters at once, so ask TMDb for the medium size.
# A cold wheel can miss on every one of its 40+ segments. Fire a real TMDb
# lookup for a handful per call rather than all of them at once: the pool is
# reshuffled on every load, so successive loads warm different segments and
# the whole wheel fills in within a few spins, without a burst of requests
# (each backfill is a search plus a details call) every time someone opens it.
WHEEL_BACKFILL_PER_CALL = 8

_WHEEL_POSTER_FROM = "/t/p/w500/"
_WHEEL_POSTER_TO = "/t/p/w342/"


def _wheel_poster_size(url: str) -> str:
    return url.replace(_WHEEL_POSTER_FROM, _WHEEL_POSTER_TO, 1)


def _cache_key(kind: str, title: str) -> str:
    return f"{kind}:{title.strip().lower()}"


def _miss_key(cat: str, title: str) -> str:
    return _cache_key(f"{_MISS}:{cat}", title)


def _lookup_order(cat: str, is_series: bool | None) -> tuple[str, ...]:
    """Which TMDb info kinds a title in `cat` can be cached under, best first.
    The single place that decides movie-vs-series for poster lookups and their
    background backfill.

    Only dc/marvel are ambiguous — a title can have both a movie_info and a
    series_info entry (e.g. "Фонари" is both a 2026 film and the "Lanterns" TV
    series) — so there `is_series` (the value stored on the item row, from the
    result the user picked in the add-search modal) picks which one to prefer.
    A legacy row added before is_series was tracked (None) keeps the old
    best-effort guess: movie first. Every other category settles it itself."""
    if cat == "series":
        return (_SERIES,)
    if cat in FRANCHISE_CATEGORIES:
        return (_SERIES, _MOVIE) if is_series is True else (_MOVIE, _SERIES)
    return (_MOVIE,)


def _fetch_info(kind: str, title: str):
    # Resolves get_series_info / get_movie_info at call time (not through a
    # module-level table) so tests can monkeypatch them on this module.
    return get_series_info(title) if kind == _SERIES else get_movie_info(title)


async def _cached_poster(cache_key: str) -> dict | None:
    info = await get_tmdb_cache(cache_key, _POSTER_CACHE_TTL)
    return info if (info or {}).get("poster_url") else None


async def lookup_poster_info(cat: str, title: str, is_series: bool | None = None) -> dict | None:
    """Cache-only cached-info dict (poster_url, resolved title, etc.) for
    `title` in category `cat`, or None if it was never resolved elsewhere.
    Which cache entry is preferred — see _lookup_order()."""
    for kind in _lookup_order(cat, is_series):
        info = await _cached_poster(_cache_key(kind, title))
        if info:
            return info
    return None


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

    orders = {is_series: _lookup_order(cat, is_series) for _, is_series in rows}
    keys_needed = {_cache_key(kind, title) for title, is_series in rows for kind in orders[is_series]}
    cached = await get_tmdb_cache_many(list(keys_needed), _POSTER_CACHE_TTL)

    out: dict[str, dict | None] = {}
    for title, is_series in rows:
        infos = (cached.get(_cache_key(kind, title)) for kind in orders[is_series])
        out[title] = next((info for info in infos if (info or {}).get("poster_url")), None)
    return out


async def lookup_no_poster_many(cat: str, rows: list[tuple[str, bool | None]]) -> set[str]:
    """Which of `rows` ((title, is_series) pairs) TMDb is *known* to have no
    poster for — as opposed to a title that just hasn't been looked up yet
    (its backfill is still pending), which a list row must not label.

    Known means either TMDb has a match for it whose cached info carries no
    poster, or the backfill recorded that TMDb has no match at all (see _MISS).
    A title with a cached poster is never in the result. Cache-only, batched
    like lookup_poster_info_many; callers pass just the rows that came back
    without a poster."""
    if not rows:
        return set()

    orders = {is_series: _lookup_order(cat, is_series) for _, is_series in rows}
    info_keys = {_cache_key(kind, title) for title, is_series in rows for kind in orders[is_series]}
    infos = await get_tmdb_cache_many(list(info_keys), _POSTER_CACHE_TTL)
    misses = await get_tmdb_cache_many([_miss_key(cat, title) for title, _ in rows], _MISS_TTL)

    out: set[str] = set()
    for title, is_series in rows:
        cached = [infos.get(_cache_key(kind, title)) for kind in orders[is_series]]
        if any((info or {}).get("poster_url") for info in cached):
            continue
        if any(info is not None for info in cached) or _miss_key(cat, title) in misses:
            out.add(title)
    return out


async def lookup_poster_url(cat: str, title: str, is_series: bool | None = None) -> str | None:
    """Cache-only poster URL for `title` in category `cat`, or None if it
    was never resolved elsewhere."""
    info = await lookup_poster_info(cat, title, is_series)
    return info["poster_url"] if info else None


async def _resolve_poster(cat: str, title: str, is_series: bool | None) -> dict | None:
    """A real (network) resolve of `title`, in _lookup_order, stopping at the
    first hit. Returns the info dict it found (which may still carry no
    poster), or None when TMDb has nothing.

    Nothing usable and TMDb really answered (not a failed request): record
    that, so lists can label the title instead of leaving the slot blank
    forever. A failed request records nothing, so it is retried next load."""
    info = None
    answered = True  # TMDb gave a real answer for every lookup that came back empty
    for kind in _lookup_order(cat, is_series):
        info = await _fetch_info(kind, title)
        if info:
            break
        answered = answered and await search_completed(_SEARCH_TYPE[kind], title)
    if not (info or {}).get("poster_url") and answered:
        await set_tmdb_cache(_miss_key(cat, title), {"no_poster": True})
    return info


async def retry_poster(cat: str, title: str, is_series: bool | None = None) -> str | None:
    """Re-check TMDb for a title the list labels "no poster", right now.

    Forgets everything cached for the title — its info entries, its TMDb
    search results (SEARCH_CACHE_TTL would otherwise replay the same answer
    for hours) and the "no match" marker — then resolves it again and waits
    for the answer, since the user is watching the row. Returns the new
    poster URL, or None if TMDb still has none (the marker is then written
    again, so the row keeps its label)."""
    kinds = _lookup_order(cat, is_series)
    keys = [_miss_key(cat, title)]
    for kind in kinds:
        keys.append(_cache_key(kind, title))
        keys.append(search_cache_key(_SEARCH_TYPE[kind], title))
    await delete_tmdb_cache(keys)
    info = await _resolve_poster(cat, title, is_series)
    return (info or {}).get("poster_url")


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
            await _resolve_poster(cat, title, is_series)
        except Exception:
            logger.warning("poster backfill failed for %r (%s)", title, cat, exc_info=True)
        finally:
            _backfill_inflight.discard(key)

    task = asyncio.create_task(_run())
    _backfill_tasks.add(task)
    task.add_done_callback(_backfill_tasks.discard)


async def resolve_wheel_posters(entries: list[tuple[str, str, bool | None]]) -> list[str | None]:
    """Cache-only poster URLs for a wheel's pool, in pool order.

    `entries` is one (cat, title, is_series) triple per segment — duplicates
    allowed, since the same title can sit in two categories (a dc/marvel lot
    resolving to a title that also has its own segment elsewhere). Grouped by
    cat so each category costs one batched tmdb_cache query via
    lookup_poster_info_many, same as the home marquee / list rows.

    Stays cache-only like the rest of this module: a miss gets a background
    schedule_poster_backfill() so the *next* spin has it, and this call
    returns None for that segment instead of waiting on a network lookup. At
    most WHEEL_BACKFILL_PER_CALL misses are scheduled per call.
    """
    if not entries:
        return []
    by_cat: dict[str, list[tuple[str, bool | None]]] = {}
    for cat, title, is_series in entries:
        by_cat.setdefault(cat, []).append((title, is_series))

    resolved: dict[tuple[str, str], str | None] = {}
    backfills = 0
    for cat, rows in by_cat.items():
        info_by_title = await lookup_poster_info_many(cat, rows)
        for title, is_series in rows:
            info = info_by_title.get(title)
            url = _wheel_poster_size(info["poster_url"]) if info else None
            resolved[(cat, title)] = url
            if url is None and backfills < WHEEL_BACKFILL_PER_CALL:
                schedule_poster_backfill(cat, title, is_series)
                backfills += 1

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
    await set_tmdb_cache(_cache_key(_SERIES if is_series else _MOVIE, title), info)
