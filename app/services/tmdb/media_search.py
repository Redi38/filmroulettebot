"""Cached TMDb title search, shared by movies/search.py and series/search.py
(previously two near-identical copies of the same cache-then-fetch and
suggestion-formatting logic — see git history). `search_multi_suggestions`
(the combined movie+TV lookup used by dc/marvel) also lives here since it
belongs to neither side more than the other."""
from __future__ import annotations

import asyncio
from typing import Any, Literal

from app.db.database import get_tmdb_cache, set_tmdb_cache

from .cache_ttl import SEARCH_CACHE_TTL
from .client import _get
from .helpers import format_search_suggestions

MediaType = Literal["movie", "tv"]

# TMDb endpoint path segment and cache-key prefix per media type.
_ENDPOINT = {"movie": "/search/movie", "tv": "/search/tv"}
_CACHE_PREFIX = {"movie": "movie_search", "tv": "tv_search"}


async def _search_cached(media_type: MediaType, title: str) -> dict[str, Any] | None:
    """Cached wrapper around /search/movie or /search/tv — shared between
    get_movie_info/get_series_info and check_upcoming_released so repeated
    lookups of the same title within SEARCH_CACHE_TTL don't hit the API
    twice."""
    cache_key = f"{_CACHE_PREFIX[media_type]}:{title.strip().lower()}"
    cached = await get_tmdb_cache(cache_key, SEARCH_CACHE_TTL)
    if cached is not None:
        return cached
    data = await _get(_ENDPOINT[media_type], query=title)
    if data is not None:
        await set_tmdb_cache(cache_key, data)
    return data


async def search_suggestions(media_type: MediaType, query: str) -> list[dict[str, Any]]:
    """Titles matching `query` for the add-a-title autocomplete picker —
    thin wrapper over the same cached search call get_movie_info/
    get_series_info already uses, just normalized down to id/title/year/
    poster."""
    query = query.strip()
    if not query:
        return []
    data = await _search_cached(media_type, query)
    if not data or not data.get("results"):
        return []
    return format_search_suggestions(data["results"], is_series=media_type == "tv")


async def search_multi_suggestions(query: str) -> list[dict[str, Any]]:
    """Combined movie+TV suggestions for categories that legitimately
    contain either — dc/marvel cover both theatrical films (The Batman)
    and streaming series (Loki, Green Lantern), unlike movies/cartoons
    which are movie-only and series which is TV-only."""
    query = query.strip()
    if not query:
        return []
    movie_data, tv_data = await asyncio.gather(
        _search_cached("movie", query), _search_cached("tv", query)
    )
    tagged = (
        [(r, False) for r in (movie_data or {}).get("results", [])]
        + [(r, True) for r in (tv_data or {}).get("results", [])]
    )
    tagged.sort(key=lambda pair: pair[0].get("popularity") or 0, reverse=True)

    seen: set[tuple[int, bool]] = set()
    out: list[dict[str, Any]] = []
    for raw, is_series in tagged:
        formatted = format_search_suggestions([raw], is_series=is_series)
        if not formatted:
            continue
        item = formatted[0]
        key = (item["tmdb_id"], is_series)
        if key in seen:
            continue
        seen.add(key)
        out.append(item)
        if len(out) >= 6:
            break
    return out
