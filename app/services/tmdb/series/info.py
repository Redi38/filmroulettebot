"""The full series info card, resolved by title — mirrors
movies/info.py's shape."""
from __future__ import annotations

from typing import Any

from app.db.database import get_tmdb_cache, set_tmdb_cache

from ..cache_ttl import INFO_CACHE_TTL
from ..client import _get
from ..helpers import actors, best_match, genres, poster


async def get_series_info(title: str) -> dict[str, Any] | None:
    cache_key = f"series_info:{title.strip().lower()}"
    cached = await get_tmdb_cache(cache_key, INFO_CACHE_TTL)
    if cached is not None:
        return cached

    data = await _get("/search/tv", query=title)
    if not data or not data.get("results"):
        return None
    series = best_match(data["results"], title, title_field="name")
    if series is None:
        return None
    sid = series["id"]
    details = await _get(f"/tv/{sid}") or {}
    credits = await _get(f"/tv/{sid}/credits") or {}
    result = {
        "title": series.get("name"),
        "overview": series.get("overview") or "Описание недоступно.",
        "release_date": series.get("first_air_date") or "—",
        "rating": round(series["vote_average"], 1) if series.get("vote_average") else "—",
        "poster_url": poster(series),
        "genres": genres(details),
        "actors": actors(credits),
        "seasons": details.get("number_of_seasons") or "—",
        "episodes": details.get("number_of_episodes") or "—",
    }
    await set_tmdb_cache(cache_key, result)
    return result
