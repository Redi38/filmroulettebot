"""Studio showcase (Marvel/DC): full catalog browsing split into upcoming/
released/new-seasons, distinct from the roulette pick flow."""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException

from app.db.database import get_items
from app.services.tmdb import (
    discover_by_company,
    get_season_finale_date,
    get_tv_next_episode,
)

router = APIRouter()

STUDIO_QUERIES = {
    "marvel": ("Marvel Studios",),
    "dc": ("DC Studios",),
}

SHOWCASE_TITLE_BLOCKLIST = (
    "spidey and",
    "krypto saves the day",
    "lego",
    "strange tails",
    "official podcast",
    "get jiro",
)


def _is_showcase_junk(item: dict) -> bool:
    haystack = f"{item.get('title', '')} {item.get('original_title', '')}".strip().lower()
    if not haystack:
        return True
    return any(term in haystack for term in SHOWCASE_TITLE_BLOCKLIST)


@router.get("/api/showcase/{studio}")
async def api_showcase(studio: str) -> dict:
    if studio not in STUDIO_QUERIES:
        raise HTTPException(404, f"Unknown studio: {studio}")

    names = STUDIO_QUERIES[studio]
    movie_lists, tv_lists, tv_all_lists = await asyncio.gather(
        asyncio.gather(*(discover_by_company(n, media_type="movie") for n in names)),
        asyncio.gather(*(discover_by_company(n, media_type="tv") for n in names)),
        asyncio.gather(*(discover_by_company(n, media_type="tv", date_filter=False) for n in names)),
    )

    tv_original_keys = {
        (m.get("original_title") or m.get("title") or "").strip().lower()
        for lst in (*tv_lists, *tv_all_lists) for m in lst
    }

    seen: set[str] = set()
    movies: list[dict] = []
    for lst in (*tv_lists, *movie_lists):
        for m in lst:
            key = (m.get("title") or "").strip().lower()
            original_key = (m.get("original_title") or "").strip().lower()
            if not key or key in seen or _is_showcase_junk(m):
                continue
            if not m.get("is_series") and original_key and original_key in tv_original_keys:
                continue
            seen.add(key)
            if original_key:
                seen.add(original_key)
            movies.append(m)

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    own_list = {t.lower() for t in await get_items(studio)}
    for m in movies:
        m["in_list"] = m["title"].lower() in own_list

    tv_id_by_title: dict[str, dict] = {}
    for lst in tv_all_lists:
        for m in lst:
            key = (m.get("title") or "").strip().lower()
            if key and key not in tv_id_by_title and not _is_showcase_junk(m):
                tv_id_by_title[key] = m

    tracked = [m for m in tv_id_by_title.values() if m.get("id")]
    next_episodes = await asyncio.gather(*(get_tv_next_episode(m["id"]) for m in tracked))
    pairs = [(m, nxt) for m, nxt in zip(tracked, next_episodes) if nxt]
    finales = await asyncio.gather(*(
        get_season_finale_date(m["id"], nxt["season_number"])
        if (nxt.get("episode_number") or 1) > 1 and nxt.get("season_number")
        else asyncio.sleep(0)
        for m, nxt in pairs
    ))
    new_seasons = []
    for (m, nxt), finale in zip(pairs, finales):
        entry = dict(m)
        entry["in_list"] = (m.get("title") or "").strip().lower() in own_list
        entry["next_season"] = nxt
        entry["airing_now"] = (nxt.get("episode_number") or 1) > 1 and bool(finale)
        if entry["airing_now"]:
            entry["season_finale_date"] = finale
        new_seasons.append(entry)
    new_seasons.sort(key=lambda m: m["next_season"]["air_date"])

    upcoming = sorted((m for m in movies if m["release_date"] >= today), key=lambda m: m["release_date"])
    released = sorted((m for m in movies if m["release_date"] < today), key=lambda m: m["release_date"], reverse=True)
    return {"upcoming": upcoming, "released": released, "new_seasons": new_seasons}
