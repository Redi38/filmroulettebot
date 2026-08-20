"""Studio/company discovery (e.g. Marvel Studios, DC Films) — powers the
dedicated Marvel/DC roulette categories, which pull from a company's whole
catalog rather than a free-text search."""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from app.db.database import get_tmdb_cache, set_tmdb_cache

from .cache_ttl import COMPANY_ID_CACHE_TTL, DISCOVER_CACHE_TTL
from .client import _get
from .helpers import poster

logger = logging.getLogger(__name__)

TALK_GENRE_ID = 10767  # official aftershow/companion podcasts get tagged with this
KIDS_GENRE_ID = 10762  # preschool/toy-line spinoffs (e.g. LEGO shows) get tagged with this


async def _resolve_company_id(name: str) -> int | None:
    """Resolve a studio name to its TMDb company id via search, caching the
    result near-permanently since these ids never change."""
    cache_key = f"company_id:{name.strip().lower()}"
    cached = await get_tmdb_cache(cache_key, COMPANY_ID_CACHE_TTL)
    if cached is not None:
        return cached.get("id")
    data = await _get("/search/company", query=name)
    if not data or not data.get("results"):
        return None
    company_id = data["results"][0]["id"]
    await set_tmdb_cache(cache_key, {"id": company_id})
    return company_id


async def discover_by_company(
    name: str, *, media_type: str = "movie", date_filter: bool = True
) -> list[dict[str, Any]]:
    """Movies or TV shows from a studio (e.g. Marvel Studios, DC Films),
    spanning roughly the last year through everything TMDb has scheduled —
    callers split this into "released" / "upcoming" against today's date.
    Cached as a whole since it doesn't need to be fresher than a few hours.

    date_filter=False skips the "last year" window entirely and just walks
    the studio's whole catalog sorted by popularity — used to resolve a
    show's TMDb id for "new season" lookups, since a series a user already
    has in their list very likely first aired *more* than a year ago and
    would otherwise never appear in the windowed results at all.
    """
    is_series = media_type == "tv"
    cache_key = f"discover:{media_type}:{'windowed' if date_filter else 'all'}:{name.strip().lower()}"
    cached = await get_tmdb_cache(cache_key, DISCOVER_CACHE_TTL)
    if cached is not None:
        return cached

    company_id = await _resolve_company_id(name)
    if company_id is None:
        return []

    query_date_field = "first_air_date" if is_series else "primary_release_date"
    response_date_field = "first_air_date" if is_series else "release_date"
    one_year_ago = (datetime.now(timezone.utc) - timedelta(days=365)).strftime("%Y-%m-%d")

    MAX_PAGES = 5
    results: list[dict[str, Any]] = []
    page = 1
    while page <= MAX_PAGES:
        params: dict[str, Any] = {
            "with_companies": company_id,
            "page": page,
        }
        if date_filter:
            params["sort_by"] = f"{query_date_field}.asc"
            params[f"{query_date_field}.gte"] = one_year_ago
        else:
            params["sort_by"] = "popularity.desc"
        data = await _get(f"/discover/{media_type}", **params)
        if not data:
            break
        results.extend(data.get("results", []))
        total_pages = data.get("total_pages") or 1
        if page >= total_pages:
            break
        page += 1

    if not results:
        logger.warning("TMDb discover/%s returned no results for company %r (id=%s)", media_type, name, company_id)

    if is_series:
        results = [
            m for m in results
            if TALK_GENRE_ID not in (m.get("genre_ids") or [])
            and KIDS_GENRE_ID not in (m.get("genre_ids") or [])
        ]

    title_field = "name" if is_series else "title"
    original_field = "original_name" if is_series else "original_title"
    out = [
        {
            "id": m.get("id"),
            "title": m.get(title_field),
            "original_title": m.get(original_field) or "",
            "release_date": m.get(response_date_field) or "",
            "poster_url": poster(m),
            "overview": m.get("overview") or "",
            "rating": round(m["vote_average"], 1) if m.get("vote_average") else "—",
            "is_series": is_series,
        }
        for m in results
        if m.get(response_date_field)
    ]
    await set_tmdb_cache(cache_key, out)
    return out
