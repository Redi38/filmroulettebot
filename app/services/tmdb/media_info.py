"""Full media info card (title/overview/rating/genres/actors/poster) used
by the "add title" flow and roulette result cards — shared by
movies/info.py and series/info.py (previously two near-identical copies
of the same cache check -> search -> best_match -> fetch details+credits
-> build result dict pipeline, differing only in endpoint and a couple of
field names; see git history). Mirrors how media_search.py already
unified the two sides' cached-search logic, and how details.py already
unifies the by-id equivalent of this same card via its own is_series
flag."""
from __future__ import annotations

from typing import Any, Literal

from app.db.database import get_tmdb_cache, set_tmdb_cache

from .cache_ttl import INFO_CACHE_TTL
from .client import _get
from .helpers import POSTER_LARGE, actors, best_match, genres, poster
from .media_search import _search_cached

MediaType = Literal["movie", "tv"]

# TMDb endpoint path segment, title/date field names, and cache-key prefix
# per media type. The cache-key prefixes are load-bearing beyond this
# module: app/web/server/shared/posters.py reads the tmdb_cache table
# directly under these same "movie_info"/"series_info" prefixes, so they
# must stay exactly as get_movie_info/get_series_info used before this
# module existed.
_ENDPOINT = {"movie": "/movie", "tv": "/tv"}
_CACHE_PREFIX = {"movie": "movie_info", "tv": "series_info"}
_TITLE_FIELD = {"movie": "title", "tv": "name"}
_DATE_FIELD = {"movie": "release_date", "tv": "first_air_date"}


async def get_media_info(media_type: MediaType, title: str) -> dict[str, Any] | None:
    """Resolve `title` to a full TMDb info card (movie or tv).

    Note: series lookups previously bypassed the shared search cache
    (series/info.py used to call `_get("/search/tv", ...)` directly instead
    of the cached wrapper movies/info.py already used) — routing both sides
    through `_search_cached` here fixes that along with the duplication.
    """
    cache_key = f"{_CACHE_PREFIX[media_type]}:{title.strip().lower()}"
    cached = await get_tmdb_cache(cache_key, INFO_CACHE_TTL)
    if cached is not None:
        return cached

    data = await _search_cached(media_type, title)
    if not data or not data.get("results"):
        return None
    title_field = _TITLE_FIELD[media_type]
    item = best_match(data["results"], title, title_field=title_field)
    if item is None:
        return None
    item_id = item["id"]
    endpoint = _ENDPOINT[media_type]
    details = await _get(f"{endpoint}/{item_id}") or {}
    credits = await _get(f"{endpoint}/{item_id}/credits") or {}
    result: dict[str, Any] = {
        "title": item.get(title_field),
        "overview": item.get("overview") or "Описание недоступно.",
        "release_date": item.get(_DATE_FIELD[media_type]) or "—",
        "rating": round(item["vote_average"], 1) if item.get("vote_average") else "—",
        "poster_url": poster(item, POSTER_LARGE),
        "genres": genres(details),
        "actors": actors(credits),
    }
    if media_type == "tv":
        result["seasons"] = details.get("number_of_seasons") or "—"
        result["episodes"] = details.get("number_of_episodes") or "—"
    else:
        result["runtime"] = details.get("runtime") or "—"

    await set_tmdb_cache(cache_key, result)
    return result
