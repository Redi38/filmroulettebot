"""Global "series releases soon" discovery — new seasons of returning
shows and freshly debuting series alike, independent of the user's own
tracked list (see tracked.py for that)."""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from typing import Any

from app.db.database import get_tmdb_cache, set_tmdb_cache

from ..cache_ttl import DISCOVER_CACHE_TTL
from ..client import _get
from ..helpers import POSTER_ROW, poster
from .episodes import get_season_finale_date, get_tv_next_episode

MAX_SERIES_EPISODES = 100


async def get_series_releases(region: str = "UA", pages: int = 3) -> list[dict[str, Any]]:
    """Popular TV shows with an episode airing soon — new seasons of
    returning shows AND freshly debuting series, global TMDb discovery,
    independent of the user's own tracked list (unlike the old per-title
    check this replaces). Long-running shows (100+ total episodes — soaps,
    daily procedurals, etc.) are excluded: they always have "a new episode
    soon" by nature and would otherwise crowd out shows actually worth
    noticing here.

    Bug fix: unlike get_now_playing/get_upcoming_theatrical, this used to
    have no caching at all — every call (including every single pagination
    click) re-ran the whole live pipeline (3 discover pages, then a
    get_tv_next_episode and possibly get_season_finale_date call *per*
    show). Besides being slow, that made the result set genuinely
    non-deterministic between two nearly-simultaneous requests (transient
    network hiccups, TMDb's popularity-sorted discover results shifting
    slightly between calls), which showed up as total_pages changing while
    paging through the same listing (e.g. "1/2" then "2/3" a moment
    later). Cache the final result the same way the sibling listings do.
    """
    cache_key = f"series_releases:{region}"
    cached = await get_tmdb_cache(cache_key, DISCOVER_CACHE_TTL)
    if cached is not None:
        return cached

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
            "poster_url": poster(r, POSTER_ROW),
            "overview": r.get("overview") or "",
            "rating": round(r["vote_average"], 1) if r.get("vote_average") else "—",
            "is_series": True,
            "season_number": season_no,
            "is_new_season": season_no > 1 and ep_no == 1,
            # A debuting show (season 1, episode 1) reads very differently
            # from "season 4 of something you already follow", but until now
            # both fell under the same catch-all row — flag it so the tab can
            # offer a "новые сериалы" filter instead of making the user infer
            # it from the date line.
            "is_new_series": season_no == 1 and ep_no == 1,
            "airing_now": airing_now,
        })
    out.sort(key=lambda m: m["release_date"])
    await set_tmdb_cache(cache_key, out)
    return out
