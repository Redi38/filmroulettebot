"""Async TMDb API service with retry/backoff and response caching."""
from __future__ import annotations

import asyncio
import logging
import random
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx

from app.config import settings
from app.db.database import get_tmdb_cache, set_tmdb_cache

logger = logging.getLogger(__name__)
_BASE = "https://api.themoviedb.org/3"
_KEY = settings.TMDB_API_KEY

_MAX_RETRIES = 3
_BACKOFF_BASE = 1.0  # seconds
_RETRYABLE_STATUSES = {429, 500, 502, 503, 504}

_client: httpx.AsyncClient | None = None


def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(timeout=10)
    return _client


async def close_client() -> None:
    """Close the shared client on bot shutdown."""
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None

INFO_CACHE_TTL = 24 * 3600
SEARCH_CACHE_TTL = 3 * 3600
DISCOVER_CACHE_TTL = 6 * 3600
COMPANY_ID_CACHE_TTL = 30 * 24 * 3600


async def _get(path: str, **params: Any) -> dict[str, Any] | None:
    params["api_key"] = _KEY
    params.setdefault("language", "ru-RU")
    url = f"{_BASE}{path}"

    client = _get_client()
    for attempt in range(1, _MAX_RETRIES + 1):
        try:
            resp = await client.get(url, params=params)

            if resp.status_code in _RETRYABLE_STATUSES and attempt < _MAX_RETRIES:
                retry_after = resp.headers.get("Retry-After")
                delay = float(retry_after) if retry_after else _BACKOFF_BASE * (2 ** (attempt - 1))
                delay += random.uniform(0, 0.5)
                logger.warning(
                    "TMDb %s returned %s (attempt %s/%s), retrying in %.1fs",
                    path, resp.status_code, attempt, _MAX_RETRIES, delay,
                )
                await asyncio.sleep(delay)
                continue

            resp.raise_for_status()
            return resp.json()

        except (httpx.TimeoutException, httpx.NetworkError) as exc:
            if attempt < _MAX_RETRIES:
                delay = _BACKOFF_BASE * (2 ** (attempt - 1)) + random.uniform(0, 0.5)
                logger.warning(
                    "TMDb network error on %s (attempt %s/%s): %s",
                    path, attempt, _MAX_RETRIES, exc,
                )
                await asyncio.sleep(delay)
                continue
            logger.warning("TMDb request failed after %s attempts: %s %s – %s", _MAX_RETRIES, path, params, exc)
            return None

        except httpx.HTTPStatusError as exc:
            logger.warning("TMDb request failed: %s %s – %s", path, params, exc)
            return None

        except Exception as exc:
            logger.warning("TMDb request failed: %s %s – %s", path, params, exc)
            return None

    return None


def _best_match(results: list[dict[str, Any]], query: str, title_field: str = "title") -> dict[str, Any] | None:
    """Pick the most likely correct result instead of blindly trusting results[0].

    TMDb sorts search results by its own relevance score, which is often just
    popularity — a well-known remake or a same-named low-effort title can
    outrank the film the user actually meant. We prefer an exact
    case-insensitive title match (ties broken by popularity), and only fall
    back to "most popular of all results" when nothing matches exactly.
    """
    if not results:
        return None
    q = query.strip().casefold()

    def _titles(r: dict[str, Any]) -> set[str]:
        alt = title_field.replace("title", "original_title") if "title" in title_field else "original_name"
        return {str(r.get(title_field, "")).casefold(), str(r.get(alt, "")).casefold()}

    exact = [r for r in results if q in _titles(r)]
    pool = exact or results
    return max(pool, key=lambda r: r.get("popularity") or 0)


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
    movie = _best_match(data["results"], title, title_field="title")
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
        "poster_url": _poster(movie),
        "runtime": details.get("runtime") or "—",
        "genres": _genres(details),
        "actors": _actors(credits),
    }
    await set_tmdb_cache(cache_key, result)
    return result


async def get_series_info(title: str) -> dict[str, Any] | None:
    cache_key = f"series_info:{title.strip().lower()}"
    cached = await get_tmdb_cache(cache_key, INFO_CACHE_TTL)
    if cached is not None:
        return cached

    data = await _get("/search/tv", query=title)
    if not data or not data.get("results"):
        return None
    series = _best_match(data["results"], title, title_field="name")
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
        "poster_url": _poster(series),
        "genres": _genres(details),
        "actors": _actors(credits),
        "seasons": details.get("number_of_seasons") or "—",
        "episodes": details.get("number_of_episodes") or "—",
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


async def discover_by_company(name: str) -> list[dict[str, Any]]:
    """Movies from a studio (e.g. Marvel Studios, DC Films), spanning roughly
    the last year through everything TMDb has scheduled — callers split this
    into "released" / "upcoming" against today's date. Cached as a whole
    since it doesn't need to be fresher than a few hours."""
    cache_key = f"discover:{name.strip().lower()}"
    cached = await get_tmdb_cache(cache_key, DISCOVER_CACHE_TTL)
    if cached is not None:
        return cached

    company_id = await _resolve_company_id(name)
    if company_id is None:
        return []

    one_year_ago = (datetime.now(timezone.utc) - timedelta(days=365)).strftime("%Y-%m-%d")

    # TMDb returns 20 results/page, sorted ascending from one_year_ago —
    # a studio with 20+ movies in that window would silently cut off the
    # newest/announced titles (sorted to the end) if we only fetched page 1.
    # Walk a few pages to make sure recent announcements aren't dropped.
    MAX_PAGES = 5
    results: list[dict[str, Any]] = []
    page = 1
    while page <= MAX_PAGES:
        data = await _get(
            "/discover/movie",
            with_companies=company_id,
            sort_by="primary_release_date.asc",
            **{"primary_release_date.gte": one_year_ago},
            region="US",
            page=page,
        )
        if not data:
            break
        results.extend(data.get("results", []))
        total_pages = data.get("total_pages") or 1
        if page >= total_pages:
            break
        page += 1

    out = [
        {
            "title": m.get("title"),
            "release_date": m.get("release_date") or "",
            "poster_url": _poster(m),
            "overview": m.get("overview") or "",
            "rating": round(m["vote_average"], 1) if m.get("vote_average") else "—",
        }
        for m in results
        if m.get("release_date")
    ]
    await set_tmdb_cache(cache_key, out)
    return out


def _poster(obj: dict) -> str | None:
    path = obj.get("poster_path")
    return f"https://image.tmdb.org/t/p/w500{path}" if path else None


def _genres(details: dict) -> str:
    return ", ".join(g["name"] for g in details.get("genres", [])) or "—"


def _actors(credits: dict) -> str:
    return ", ".join(a["name"] for a in credits.get("cast", [])[:3]) or "—"
