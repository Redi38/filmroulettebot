"""Digital/streaming-release heuristics: is an upcoming movie already
watchable, and is a release only local/regional rather than global."""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Any

from app.db.database import get_tmdb_cache, set_tmdb_cache

from ..cache_ttl import SEARCH_CACHE_TTL
from ..client import _get
from .search import _search_movie_cached


async def _get_digital_release_date(movie_id: int) -> str | None:
    """Real digital/streaming release date from TMDb's release_dates endpoint
    (type 4 = Digital), preferring the US region since it's the most
    consistently populated. Returns None if TMDb has no digital date on file
    yet — callers then fall back to the "45 days after theatrical" heuristic."""
    cache_key = f"release_dates:{movie_id}"
    cached = await get_tmdb_cache(cache_key, SEARCH_CACHE_TTL)
    if cached is not None:
        data = cached
    else:
        data = await _get(f"/movie/{movie_id}/release_dates")
        if data is not None:
            await set_tmdb_cache(cache_key, data)
    if not data:
        return None

    by_country = {r["iso_3166_1"]: r for r in data.get("results", [])}
    regions = [by_country["US"]] if "US" in by_country else list(by_country.values())
    for region in regions:
        for rd in region.get("release_dates", []):
            if rd.get("type") == 4:  # 4 = Digital (см. TMDb release_dates docs)
                date_str = (rd.get("release_date") or "")[:10]
                if date_str:
                    return date_str
    return None


async def check_upcoming_released(titles: list[str]) -> dict[str, list]:
    """Check which upcoming movies are out.

    Prefers the REAL digital/streaming release date from TMDb (type 4).
    Falls back to a "45 days after theatrical release" heuristic only when
    TMDb doesn't have a digital date on file yet — common right after a
    theatrical release, before distributors announce the digital date.
    Each entry carries "estimated": True when the heuristic was used, so
    callers can flag it as approximate rather than confirmed.
    """
    now = datetime.now(timezone.utc)
    current_year = now.year
    released: list[dict] = []
    not_yet: list[dict] = []
    no_info: list[str] = []
    for title in titles:
        data = await _search_movie_cached(title)
        if not data or not data.get("results"):
            no_info.append(title)
            continue
        matched = next(
            (
                m for m in data["results"]
                if (m.get("release_date") or "")[:4].isdigit()
                and int((m.get("release_date") or "")[:4]) == current_year
            ),
            None,
        )
        if not matched or len(matched.get("release_date", "")) < 10:
            no_info.append(title)
            continue

        digital_date_str = await _get_digital_release_date(matched["id"])
        estimated = digital_date_str is None
        date_to_use = digital_date_str or matched["release_date"][:10]

        try:
            check_date = datetime.strptime(date_to_use, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        except ValueError:
            no_info.append(title)
            continue

        days_ago = (now - check_date).days
        is_out = days_ago >= 0 if not estimated else days_ago >= 45
        entry = {
            "title": title,
            "tmdb_title": matched.get("title", title),
            "release_date": date_to_use,
            "days_ago": days_ago,
            "estimated": estimated,
        }
        (released if is_out else not_yet).append(entry)
    return {"released": released, "not_yet": not_yet, "no_info": no_info}


async def is_digitally_released(movie_id: int, release_date: str) -> bool:
    """Best-effort check for whether a theatrical movie is already available
    digitally — reuses the real digital-release date from TMDb when known,
    falling back to the same "45 days after theatrical" heuristic used by
    check_upcoming_released."""
    now = datetime.now(timezone.utc)
    digital_date_str = await _get_digital_release_date(movie_id)
    date_to_use = (digital_date_str or release_date or "")[:10]
    try:
        check_date = datetime.strptime(date_to_use, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    except ValueError:
        return False
    days_ago = (now - check_date).days
    return days_ago >= 0 if digital_date_str else days_ago >= 45


GLOBAL_RELEASE_MIN_COUNTRIES = 5
"""Threshold for the "hide local-only Афиша titles" setting: TMDb has no
explicit "global release" flag, so we approximate it by counting how many
countries carry a release_dates entry for the movie. Below this, we treat
it as a local/regional-only release. This is a heuristic, not a fact — a
small festival title can legitimately have few countries listed even
though it's not "local" in the sense the setting is meant to catch."""


async def _release_country_count(movie_id: int) -> int:
    """Number of distinct countries with a release_dates entry for this
    movie. Reuses the same endpoint/cache-key-prefix approach as
    _get_digital_release_date, but caches the *count* separately since it's
    a different derived value with effectively-permanent TTL (a movie's
    historical release footprint doesn't change once cached data is a bit
    stale — reuses SEARCH_CACHE_TTL rather than inventing a new one)."""
    cache_key = f"release_country_count:{movie_id}"
    cached = await get_tmdb_cache(cache_key, SEARCH_CACHE_TTL)
    if cached is not None:
        return cached["count"]
    data = await _get(f"/movie/{movie_id}/release_dates")
    count = len(data.get("results", [])) if data else 0
    await set_tmdb_cache(cache_key, {"count": count})
    return count


async def filter_globally_released(movies: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Drop movies that only released in a handful of countries (see
    GLOBAL_RELEASE_MIN_COUNTRIES). Movies without a TMDb id are kept as-is —
    there's nothing to check them against, better to show than to guess."""
    with_id = [m for m in movies if m.get("id")]
    counts = await asyncio.gather(*(_release_country_count(m["id"]) for m in with_id))
    local_ids = {
        m["id"] for m, count in zip(with_id, counts) if count < GLOBAL_RELEASE_MIN_COUNTRIES
    }
    return [m for m in movies if m.get("id") not in local_ids]
