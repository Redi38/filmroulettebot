"""Series-flavored wrapper over ../media_search.py's cached-search and
suggestion logic — mirrors movies/search.py's shape."""
from __future__ import annotations

from typing import Any

from ..media_search import _search_cached, search_suggestions

__all__ = ["search_series_suggestions"]


async def _search_tv_cached(title: str) -> dict[str, Any] | None:
    """Cached wrapper around /search/tv, mirroring _search_movie_cached."""
    return await _search_cached("tv", title)


async def search_series_suggestions(query: str) -> list[dict[str, Any]]:
    """Titles matching `query` for the add-a-title autocomplete picker —
    mirrors search_movie_suggestions but over /search/tv."""
    return await search_suggestions("tv", query)
