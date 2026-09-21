"""Movie-flavored wrapper over ../media_info.py's cached info-card logic —
mirrors movies/search.py's shape."""
from __future__ import annotations

from typing import Any

from ..media_info import get_media_info

__all__ = ["get_movie_info"]


async def get_movie_info(title: str) -> dict[str, Any] | None:
    """Full movie info card (title/overview/rating/genres/actors/poster),
    resolved by title — used by the "add title" flow and roulette result
    cards."""
    return await get_media_info("movie", title)
