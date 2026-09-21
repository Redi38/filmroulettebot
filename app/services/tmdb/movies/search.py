"""Movie-flavored wrappers over ../media_search.py's cached-search and
suggestion logic (movie-only suggestions; combined movie+TV suggestions
now live in media_search.py directly)."""
from __future__ import annotations

from typing import Any

from ..media_search import _search_cached, search_multi_suggestions, search_suggestions

__all__ = ["search_movie_suggestions", "search_multi_suggestions"]


async def _search_movie_cached(title: str) -> dict[str, Any] | None:
    """Cached wrapper around /search/movie — shared between get_movie_info
    and check_upcoming_released so repeated lookups of the same title
    within SEARCH_CACHE_TTL don't hit the API twice."""
    return await _search_cached("movie", title)


async def search_movie_suggestions(query: str) -> list[dict[str, Any]]:
    """Titles matching `query` for the add-a-title autocomplete picker."""
    return await search_suggestions("movie", query)
