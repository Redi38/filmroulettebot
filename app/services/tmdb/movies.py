"""Movie-specific TMDb lookups: search-by-title info cards, now-playing /
upcoming theatrical listings, and the digital-release-date heuristics used
to tell whether an upcoming movie is already watchable."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from app.db.database import get_tmdb_cache, set_tmdb_cache

from .cache_ttl import DISCOVER_CACHE_TTL, INFO_CACHE_TTL, SEARCH_CACHE_TTL
from .client import _get
from .helpers import actors, best_match, format_movie_results, genres, poster


async def _search_movie_cached(title: str) -> dict[str, Any] | None:
    """Cached wrapper around /search/movie — shared between get_movie_info
    and check_upcoming_released so repeated lookups of the same title
    within SEARCH_CACHE_TTL don't hit the API twice."""
    cache_key = f"movie_search:{title.strip().lower()}"
    cached = await get_tmdb_cache(cache_key, SEARCH_CACHE_TTL)
    if cached is not None:
        return cached
    data = await _get("/search/movie", query=title)
    if data is not None:
        await set_tmdb_cache(cache_key, data)
    return data


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
    released, not_yet, no_info = [], [], []
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


async def get_now_playing(region: str = "UA", pages: int = 3) -> list[dict[str, Any]]:
    """Movies currently in theaters, per TMDb's own now_playing endpoint.

    Fetches several pages (TMDb returns 20/page) rather than just the first —
    a single page leaves too small a pool once the freshness cutoff and any
    skipped titles are filtered out, so a skip has nothing left to backfill
    the page with.
    """
    cache_key = f"now_playing:{region}:{pages}"
    cached = await get_tmdb_cache(cache_key, DISCOVER_CACHE_TTL)
    if cached is not None:
        return cached
    raw: list[dict[str, Any]] = []
    for page in range(1, pages + 1):
        data = await _get("/movie/now_playing", region=region, page=page)
        if not data or not data.get("results"):
            break
        raw.extend(data["results"])
        if page >= (data.get("total_pages") or 1):
            break
    out = format_movie_results(raw)
    await set_tmdb_cache(cache_key, out)
    return out


async def get_upcoming_theatrical(region: str = "UA", pages: int = 3) -> list[dict[str, Any]]:
    """Movies with an upcoming theatrical release, per TMDb's own upcoming
    endpoint — distinct from the user's own manually-tracked upcoming list
    in the database, this is TMDb's global release calendar. Same
    multi-page fetch as get_now_playing, for the same reason (skip backfill
    needs a reserve pool beyond one page)."""
    cache_key = f"upcoming_theatrical:{region}:{pages}"
    cached = await get_tmdb_cache(cache_key, DISCOVER_CACHE_TTL)
    if cached is not None:
        return cached
    raw: list[dict[str, Any]] = []
    for page in range(1, pages + 1):
        data = await _get("/movie/upcoming", region=region, page=page)
        if not data or not data.get("results"):
            break
        raw.extend(data["results"])
        if page >= (data.get("total_pages") or 1):
            break
    out = format_movie_results(raw)
    await set_tmdb_cache(cache_key, out)
    return out
