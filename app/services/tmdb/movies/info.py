"""Full movie info card (title/overview/rating/genres/actors/poster) used
by the "add title" flow and roulette result cards."""
from __future__ import annotations

from typing import Any

from app.db.database import get_tmdb_cache, set_tmdb_cache

from ..cache_ttl import INFO_CACHE_TTL
from ..client import _get
from ..helpers import actors, best_match, genres, poster
from .search import _search_movie_cached


async def get_movie_info(title: str) -> dict[str, Any] | None:
    cache_key = f"movie_info:{title.strip().lower()}"
    cached = await get_tmdb_cache(cache_key, INFO_CACHE_TTL)
    if cached is not None:
        return cached

    data = await _search_movie_cached(title)
    if not data or not data.get("results"):
        return None
    movie = best_match(data["results"], title, title_field="title")
    if movie is None:
        return None
    mid = movie["id"]
    details = await _get(f"/movie/{mid}") or {}
    credits = await _get(f"/movie/{mid}/credits") or {}
    result = {
        "title": movie.get("title"),
        "overview": movie.get("overview") or "Описание недоступно.",
        "release_date": movie.get("release_date") or "—",
        "rating": round(movie["vote_average"], 1) if movie.get("vote_average") else "—",
        "poster_url": poster(movie),
        "runtime": details.get("runtime") or "—",
        "genres": genres(details),
        "actors": actors(credits),
    }
    await set_tmdb_cache(cache_key, result)
    return result
