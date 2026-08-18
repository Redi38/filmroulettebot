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
        "poster_url": _poster(details),
        "genres": _genres(details),
        "actors": _actors(credits),
        "trailer_url": _best_trailer_url(videos),
    }
    if is_series:
        result["seasons"] = details.get("number_of_seasons") or "—"
        result["episodes"] = details.get("number_of_episodes") or "—"
    else:
        result["runtime"] = details.get("runtime") or "—"

    await set_tmdb_cache(cache_key, result)
    return result


def _best_trailer_url(videos: dict) -> str | None:
    results = videos.get("results") or []
    youtube = [v for v in results if v.get("site") == "YouTube"]
    trailers = [v for v in youtube if v.get("type") == "Trailer"]
    pick = next((v for v in trailers if v.get("official")), None) or (trailers[0] if trailers else None)
    if not pick:
        teasers = [v for v in youtube if v.get("type") == "Teaser"]
        pick = teasers[0] if teasers else None
    return f"https://www.youtube.com/watch?v={pick['key']}" if pick else None


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


TALK_GENRE_ID = 10767  # official aftershow/companion podcasts get tagged with this
KIDS_GENRE_ID = 10762  # preschool/toy-line spinoffs (e.g. LEGO shows) get tagged with this


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
            "poster_url": _poster(m),
            "overview": m.get("overview") or "",
            "rating": round(m["vote_average"], 1) if m.get("vote_average") else "—",
            "is_series": is_series,
        }
        for m in results
        if m.get(response_date_field)
    ]
    await set_tmdb_cache(cache_key, out)
    return out


async def get_tv_next_episode(tv_id: int) -> dict[str, Any] | None:
    """Next unaired episode for a TV show, if TMDb has one scheduled — used
    to flag "new season coming" for shows already in the user's own list,
    without them having to keep checking manually."""
    cache_key = f"tv_next_episode:{tv_id}"
    cached = await get_tmdb_cache(cache_key, DISCOVER_CACHE_TTL)
    if cached is not None:
        return cached or None
    data = await _get(f"/tv/{tv_id}")
    nxt = (data or {}).get("next_episode_to_air") or {}
    out = (
        {"season_number": nxt.get("season_number"), "episode_number": nxt.get("episode_number"), "air_date": nxt.get("air_date")}
        if nxt.get("air_date")
        else None
    )
    await set_tmdb_cache(cache_key, out or {})
    return out


def _format_movie_results(results: list[dict]) -> list[dict[str, Any]]:
    return [
        {
            "id": m.get("id"),
            "title": m.get("title"),
            "original_title": m.get("original_title") or "",
            "release_date": m.get("release_date") or "",
            "poster_url": _poster(m),
            "overview": m.get("overview") or "",
            "rating": round(m["vote_average"], 1) if m.get("vote_average") else "—",
            "is_series": False,
        }
        for m in results
        if m.get("release_date")
    ]


async def _search_tv_cached(title: str) -> dict[str, Any] | None:
    """Cached wrapper around /search/tv, mirroring _search_movie_cached."""
    cache_key = f"tv_search:{title.strip().lower()}"
    cached = await get_tmdb_cache(cache_key, SEARCH_CACHE_TTL)
    if cached is not None:
        return cached
    data = await _get("/search/tv", query=title)
    if data is not None:
        await set_tmdb_cache(cache_key, data)
    return data


async def _get_new_season_entry(title: str) -> dict[str, Any] | None:
    """If `title` (one of the user's own tracked series) has an announced
    upcoming episode/season on TMDb, return a showcase-style row for it —
    same shape the Marvel/DC studio showcase's new_seasons entries use."""
    data = await _search_tv_cached(title)
    if not data or not data.get("results"):
        return None
    series = _best_match(data["results"], title, title_field="name")
    if series is None or not series.get("id"):
        return None
    nxt = await get_tv_next_episode(series["id"])
    if not nxt:
        return None
    return {
        "id": series["id"],
        "title": series.get("name") or title,
        "original_title": series.get("original_name") or "",
        "release_date": nxt.get("air_date") or "",
        "poster_url": _poster(series),
        "overview": series.get("overview") or "",
        "rating": round(series["vote_average"], 1) if series.get("vote_average") else "—",
        "is_series": True,
        "next_season": nxt,
    }


async def get_new_seasons_for_titles(titles: list[str]) -> list[dict[str, Any]]:
    """Announced new seasons/episodes for the user's own tracked series list —
    the same TMDb next-episode check the Marvel/DC showcase does, but run
    across the whole series list instead of one studio's titles."""
    entries = await asyncio.gather(*(_get_new_season_entry(t) for t in titles))
    out = [e for e in entries if e]
    out.sort(key=lambda m: m["next_season"]["air_date"])
    return out


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


async def get_now_playing(region: str = "UA") -> list[dict[str, Any]]:
    """Movies currently in theaters, per TMDb's own now_playing endpoint."""
    cache_key = f"now_playing:{region}"
    cached = await get_tmdb_cache(cache_key, DISCOVER_CACHE_TTL)
    if cached is not None:
        return cached
    data = await _get("/movie/now_playing", region=region)
    out = _format_movie_results((data or {}).get("results", []))
    await set_tmdb_cache(cache_key, out)
    return out


async def get_upcoming_theatrical(region: str = "UA") -> list[dict[str, Any]]:
    """Movies with an upcoming theatrical release, per TMDb's own upcoming
    endpoint — distinct from the user's own manually-tracked upcoming list
    in the database, this is TMDb's global release calendar."""
    cache_key = f"upcoming_theatrical:{region}"
    cached = await get_tmdb_cache(cache_key, DISCOVER_CACHE_TTL)
    if cached is not None:
        return cached
    data = await _get("/movie/upcoming", region=region)
    out = _format_movie_results((data or {}).get("results", []))
    await set_tmdb_cache(cache_key, out)
    return out


def _poster(obj: dict) -> str | None:
    path = obj.get("poster_path")
    return f"https://image.tmdb.org/t/p/w500{path}" if path else None


def _genres(details: dict) -> str:
    return ", ".join(g["name"] for g in details.get("genres", [])) or "—"


def _actors(credits: dict) -> str:
    return ", ".join(a["name"] for a in credits.get("cast", [])[:3]) or "—"
