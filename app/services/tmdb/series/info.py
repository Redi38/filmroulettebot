"""Series-flavored wrapper over ../media_info.py's cached info-card logic —
mirrors series/search.py's shape."""
from __future__ import annotations

from typing import Any

from ..media_info import get_media_info

__all__ = ["get_series_info"]


async def get_series_info(title: str) -> dict[str, Any] | None:
    """Full series info card (title/overview/rating/genres/actors/poster),
    resolved by title — mirrors get_movie_info's shape."""
    return await get_media_info("tv", title)
