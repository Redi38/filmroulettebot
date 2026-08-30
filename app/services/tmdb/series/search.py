"""Cached /search/tv lookups and the add-a-title autocomplete suggestions
built on top of them — mirrors movies/search.py's shape."""
from __future__ import annotations

from typing import Any

from app.db.database import get_tmdb_cache, set_tmdb_cache

from ..cache_ttl import SEARCH_CACHE_TTL
from ..client import _get
from ..helpers import format_search_suggestions


async def _search_tv_cached(title: str) -> dict[str, Any] | None:
    """Cached wrapper around /search/tv, mirroring _search_movie_cached."""
    cache_key = f"tv_search:{title.strip().lower()}"
    cached = await get_tmdb_cache(cache_key, SEARCH_CACHE_TTL)
    if cached is not None:
        return cached
    data = await _get("/search/tv", query=title)
    if data is not None:
        await set_tmdb_cache(cache_key, data)
    return data


async def search_series_suggestions(query: str) -> list[dict[str, Any]]:
    """Titles matching `query` for the add-a-title autocomplete picker —
    mirrors search_movie_suggestions but over /search/tv."""
    query = query.strip()
    if not query:
        return []
    data = await _search_tv_cached(query)
    if not data or not data.get("results"):
        return []
    return format_search_suggestions(data["results"], is_series=True)
