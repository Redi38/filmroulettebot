"""Async TMDb API service with retry/backoff and response caching."""
from __future__ import annotations

import asyncio
import logging
import random
from datetime import datetime, timezone
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

# Готовая карточка (title/overview/rating/...) меняется редко — кэшируем на сутки.
INFO_CACHE_TTL = 24 * 3600
# Сырые результаты поиска для /upcoming — TTL короче, т.к. даты выхода важно сверять свежими.
SEARCH_CACHE_TTL = 3 * 3600


async def _get(path: str, **params: Any) -> dict[str, Any] | None:
    params["api_key"] = _KEY
    params.setdefault("language", "ru-RU")
    url = f"{_BASE}{path}"

    for attempt in range(1, _MAX_RETRIES + 1):
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(url, params=params)

            if resp.status_code in _RETRYABLE_STATUSES and attempt < _MAX_RETRIES:
                retry_after = resp.headers.get("Retry-After")
                delay = float(retry_after) if retry_after else _BACKOFF_BASE * (2 ** (attempt - 1))
                delay += random.uniform(0, 0.5)  # джиттер против одновременных ретраев
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
    movie = data["results"][0]
    mid = movie["id"]
    details = await _get(f"/movie/{mid}") or {}
    credits = await _get(f"/movie/{mid}/credits") or {}
    result = {
        "title": movie.get("title"),
        "overview": movie.get("overview") or "Описание недоступно.",
        "release_date": movie.get("release_date") or "—",
        "rating": movie.get("vote_average") or "—",
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
    series = data["results"][0]
    sid = series["id"]
    details = await _get(f"/tv/{sid}") or {}
    credits = await _get(f"/tv/{sid}/credits") or {}
    result = {
        "title": series.get("name"),
        "overview": series.get("overview") or "Описание недоступно.",
        "release_date": series.get("first_air_date") or "—",
        "rating": series.get("vote_average") or "—",
        "poster_url": _poster(series),
        "genres": _genres(details),
        "actors": _actors(credits),
        "seasons": details.get("number_of_seasons") or "—",
        "episodes": details.get("number_of_episodes") or "—",
    }
    await set_tmdb_cache(cache_key, result)
    return result


async def check_upcoming_released(titles: list[str]) -> dict[str, list]:
    """Check which upcoming movies have been released (≥45 days ago, current year)."""
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
        try:
            release_date = datetime.strptime(matched["release_date"][:10], "%Y-%m-%d").replace(tzinfo=timezone.utc)
        except ValueError:
            no_info.append(title)
            continue
        days_ago = (now - release_date).days
        entry = {"title": title, "tmdb_title": matched.get("title", title),
                 "release_date": matched["release_date"][:10], "days_ago": days_ago}
        (released if days_ago >= 45 else not_yet).append(entry)
    return {"released": released, "not_yet": not_yet, "no_info": no_info}


def _poster(obj: dict) -> str | None:
    path = obj.get("poster_path")
    return f"https://image.tmdb.org/t/p/w500{path}" if path else None


def _genres(details: dict) -> str:
    return ", ".join(g["name"] for g in details.get("genres", [])) or "—"


def _actors(credits: dict) -> str:
    return ", ".join(a["name"] for a in credits.get("cast", [])[:3]) or "—"
