"""TV-series-specific TMDb lookups, split by concern into sibling modules:
search.py (cached search + autocomplete suggestions), info.py (the full
series info card), episodes.py (next-episode / season-finale lookups
shared by the two modules below), releases.py (global "series releases
soon" discovery), and tracked.py (status resolution for the user's own
tracked series list). Mirrors the movies/ subpackage's shape.

Re-exports the same public names the old single-file series.py exposed,
so `from .series import ...` in the parent tmdb/__init__.py doesn't need
to change.
"""
from __future__ import annotations

from .episodes import get_season_finale_date, get_tv_next_episode
from .info import get_series_info
from .releases import get_series_releases
from .search import search_series_suggestions
from .tracked import get_tracked_series_status

__all__ = [
    "get_series_info",
    "get_series_releases",
    "get_tracked_series_status",
    "get_tv_next_episode",
    "get_season_finale_date",
    "search_series_suggestions",
]
