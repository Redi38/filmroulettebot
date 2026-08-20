"""Async TMDb API service with retry/backoff and response caching.

Split by concern into sibling modules (client/movies/series/studios/
details/helpers); this file re-exports the same public names the old
single-file app/services/tmdb.py exposed, so `from app.services.tmdb import
...` call sites elsewhere in the app don't need to change.
"""
from __future__ import annotations

from .cache_ttl import (
    COMPANY_ID_CACHE_TTL,
    DISCOVER_CACHE_TTL,
    INFO_CACHE_TTL,
    SEARCH_CACHE_TTL,
)
from .client import close_client
from .details import get_details_by_id
from .movies import (
    check_upcoming_released,
    get_movie_info,
    get_now_playing,
    get_upcoming_theatrical,
    is_digitally_released,
)
from .series import (
    get_season_finale_date,
    get_series_info,
    get_series_releases,
    get_tracked_series_status,
    get_tv_next_episode,
)
from .studios import KIDS_GENRE_ID, TALK_GENRE_ID, discover_by_company

__all__ = [
    "close_client",
    "get_details_by_id",
    "check_upcoming_released",
    "get_movie_info",
    "get_now_playing",
    "get_upcoming_theatrical",
    "is_digitally_released",
    "get_season_finale_date",
    "get_series_info",
    "get_series_releases",
    "get_tracked_series_status",
    "get_tv_next_episode",
    "discover_by_company",
    "TALK_GENRE_ID",
    "KIDS_GENRE_ID",
    "INFO_CACHE_TTL",
    "SEARCH_CACHE_TTL",
    "DISCOVER_CACHE_TTL",
    "COMPANY_ID_CACHE_TTL",
]
