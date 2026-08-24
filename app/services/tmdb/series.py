"""TV-series-specific TMDb lookups: search-by-title info cards, next
unaired episode, season finale dates, global "series releases soon"
discovery, and status resolution for the user's own tracked series list."""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from typing import Any

from app.db.database import get_tmdb_cache, set_tmdb_cache

from .cache_ttl import DISCOVER_CACHE_TTL, INFO_CACHE_TTL, SEARCH_CACHE_TTL
from .client import _get
from .helpers import actors, best_match, genres, poster


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


async def get_tv_next_episode(tv_id: int) -> dict[str, Any] | None:
    """Next unaired episode for a TV show, if TMDb has one scheduled — used
    to flag "new season coming" for shows already in the user's own list,
    without them having to keep checking manually. Also carries the show's
    total episode count (already present in the same /tv/{id} response) so
    get_series_releases can filter out long-running shows without an extra
    API call."""
    cache_key = f"tv_next_episode:{tv_id}"
    cached = await get_tmdb_cache(cache_key, DISCOVER_CACHE_TTL)
    if cached is not None:
        return cached or None
    data = await _get(f"/tv/{tv_id}")
    nxt = (data or {}).get("next_episode_to_air") or {}
    out = (
        {
            "season_number": nxt.get("season_number"),
            "episode_number": nxt.get("episode_number"),
            "air_date": nxt.get("air_date"),
            "number_of_episodes": (data or {}).get("number_of_episodes"),
        }
        if nxt.get("air_date")
        else None
    )
    await set_tmdb_cache(cache_key, out or {})
    return out


async def get_season_finale_date(tv_id: int, season_number: int) -> str | None:
    """Air date of a season's last known episode — used so a season that's
    already mid-release shows "complete by X" instead of just its next
    episode's date, which for a still-airing season isn't very useful."""
    cache_key = f"tv_season_finale:{tv_id}:{season_number}"
    cached = await get_tmdb_cache(cache_key, DISCOVER_CACHE_TTL)
    if cached is not None:
        return cached.get("date") or None
    data = await _get(f"/tv/{tv_id}/season/{season_number}")
    episodes = (data or {}).get("episodes") or []
    dated = [e.get("air_date") for e in episodes if e.get("air_date")]
    finale = max(dated) if dated else None
    await set_tmdb_cache(cache_key, {"date": finale} if finale else {})
    return finale


MAX_SERIES_EPISODES = 100


async def get_series_releases(region: str = "UA", pages: int = 3) -> list[dict[str, Any]]:
    """Popular TV shows with an episode airing soon — new seasons of
    returning shows AND freshly debuting series, global TMDb discovery,
    independent of the user's own tracked list (unlike the old per-title
    check this replaces). Long-running shows (100+ total episodes — soaps,
    daily procedurals, etc.) are excluded: they always have "a new episode
    soon" by nature and would otherwise crowd out shows actually worth
    noticing here."""
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    horizon = (datetime.now(timezone.utc) + timedelta(days=45)).strftime("%Y-%m-%d")
    raw: list[dict[str, Any]] = []
    for page in range(1, pages + 1):
        data = await _get(
            "/discover/tv",
            **{
                "air_date.gte": today,
                "air_date.lte": horizon,
                "sort_by": "popularity.desc",
                "page": page,
                "watch_region": region,
            },
        )
        if not data or not data.get("results"):
            break
        raw.extend(data["results"])
        if page >= (data.get("total_pages") or 1):
            break

    seen: set[int] = set()
    unique = []
    for r in raw:
        tv_id = r.get("id")
        if not tv_id or tv_id in seen:
            continue
        seen.add(tv_id)
        unique.append(r)

    next_eps = await asyncio.gather(*(get_tv_next_episode(r["id"]) for r in unique))
    pairs = [
        (r, nxt) for r, nxt in zip(unique, next_eps)
        if nxt and nxt.get("air_date")
        and not (
            isinstance(nxt.get("number_of_episodes"), int)
            and nxt["number_of_episodes"] > MAX_SERIES_EPISODES
        )
    ]

    finales = await asyncio.gather(*(
        get_season_finale_date(r["id"], nxt["season_number"])
        if (nxt.get("episode_number") or 1) > 1 and nxt.get("season_number")
        else asyncio.sleep(0)
        for r, nxt in pairs
    ))

    out: list[dict[str, Any]] = []
    for (r, nxt), finale in zip(pairs, finales):
        ep_no = nxt.get("episode_number") or 1
        season_no = nxt.get("season_number") or 1
        airing_now = ep_no > 1 and bool(finale)
        out.append({
            "id": r["id"],
            "title": r.get("name") or "",
            "original_title": r.get("original_name") or "",
            "release_date": finale if airing_now else nxt["air_date"],
            "poster_url": poster(r),
            "overview": r.get("overview") or "",
            "rating": round(r["vote_average"], 1) if r.get("vote_average") else "—",
            "is_series": True,
            "is_new_season": season_no > 1 and ep_no == 1,
            "airing_now": airing_now,
        })
    out.sort(key=lambda m: m["release_date"])
    return out


async def get_tracked_series_status(titles: list[str]) -> list[dict[str, Any]]:
    """Resolve next-episode / season-finale status for the user's own
    personally tracked series list (added by name, unlike the global
    discovery in get_series_releases). Unlike that function, every title is
    returned even with no announced episode yet — it's the user's own list,
    so "no news yet" is still worth showing rather than being filtered out."""

    async def _resolve(title: str) -> dict[str, Any]:
        data = await _search_tv_cached(title)
        results = (data or {}).get("results") or []
        series = best_match(results, title, title_field="name") if results else None
        if series is None or not series.get("id"):
            return {
                "title": title, "original_title": "", "poster_url": None, "overview": "",
                "rating": "—", "is_series": True, "status": "not_found", "release_date": None,
            }
        nxt = await get_tv_next_episode(series["id"])
        base = {
            "id": series["id"],
            "title": series.get("name") or title,
            "original_title": series.get("original_name") or "",
            "poster_url": poster(series),
            "overview": series.get("overview") or "",
            "rating": round(series["vote_average"], 1) if series.get("vote_average") else "—",
            "is_series": True,
        }
        if not nxt or not nxt.get("air_date"):
            base.update(status="no_upcoming", release_date=None)
            return base
        ep_no = nxt.get("episode_number") or 1
        season_no = nxt.get("season_number") or 1
        finale = None
        if ep_no > 1 and season_no:
            finale = await get_season_finale_date(series["id"], season_no)
        airing_now = ep_no > 1 and bool(finale)
        base.update(
            status="announced",
            release_date=finale if airing_now else nxt["air_date"],
            is_new_season=season_no > 1 and ep_no == 1,
            airing_now=airing_now,
        )
        return base

    entries = await asyncio.gather(*(_resolve(t) for t in titles))
    entries.sort(key=lambda m: m["release_date"] or "9999-99-99")
    return list(entries)
