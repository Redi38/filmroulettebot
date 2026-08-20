"""Full detail card for an already-known TMDb id — used by the showcase/
theaters expandable panel, where the id already came from a discover/
now_playing/upcoming call and doesn't need a fuzzy title search."""
from __future__ import annotations

import asyncio
from typing import Any

from app.db.database import get_tmdb_cache, set_tmdb_cache

from .cache_ttl import INFO_CACHE_TTL
from .client import _get
from .helpers import actors, best_trailer_url, genres, poster


async def get_details_by_id(tmdb_id: int, is_series: bool) -> dict[str, Any] | None:
    """Full detail card for an already-known TMDb id (movie or tv) — used for
    the expandable detail panel on showcase/theaters rows, where we already
    have the id from discover/now_playing/upcoming and don't need to search
    by title (and risk matching the wrong title) like get_movie_info/
    get_series_info do.
    """
    kind = "tv" if is_series else "movie"
    cache_key = f"details_by_id:{kind}:{tmdb_id}"
    cached = await get_tmdb_cache(cache_key, INFO_CACHE_TTL)
    if cached is not None:
        return cached or None

    details = await _get(f"/{kind}/{tmdb_id}")
    if not details:
        await set_tmdb_cache(cache_key, {})
        return None
    credits, videos = await asyncio.gather(
        _get(f"/{kind}/{tmdb_id}/credits"),
        _get(f"/{kind}/{tmdb_id}/videos", include_video_language="ru,en,null"),
    )
    credits = credits or {}
    videos = videos or {}

    result: dict[str, Any] = {
        "title": details.get("title" if not is_series else "name"),
        "overview": details.get("overview") or "Описание недоступно.",
        "release_date": (details.get("release_date") if not is_series else details.get("first_air_date")) or "—",
        "rating": round(details["vote_average"], 1) if details.get("vote_average") else "—",
        "poster_url": poster(details),
        "genres": genres(details),
        "actors": actors(credits),
        "trailer_url": best_trailer_url(videos),
    }
    if is_series:
        result["seasons"] = details.get("number_of_seasons") or "—"
        result["episodes"] = details.get("number_of_episodes") or "—"
    else:
        result["runtime"] = details.get("runtime") or "—"

    await set_tmdb_cache(cache_key, result)
    return result
