"""Movie-related TMDb lookups, split by concern into sibling modules:
search.py (cached search + autocomplete suggestions), info.py (the full
movie info card), release.py (digital-release-date heuristics), and
listings.py (TMDb's own now-playing/upcoming theatrical listings).

Re-exports the same public names the old single-file movies.py exposed,
so `from .movies import ...` in the parent tmdb/__init__.py doesn't need
to change.
"""
from __future__ import annotations

from .info import get_movie_info
from .listings import get_now_playing, get_upcoming_theatrical
from .release import (
    check_upcoming_released,
    filter_globally_released,
    is_digitally_released,
)
from .search import search_movie_suggestions, search_multi_suggestions

__all__ = [
    "get_movie_info",
    "get_now_playing",
    "get_upcoming_theatrical",
    "check_upcoming_released",
    "filter_globally_released",
    "is_digitally_released",
    "search_movie_suggestions",
    "search_multi_suggestions",
]
