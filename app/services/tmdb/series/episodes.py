"""Per-show episode-schedule lookups shared by both series/releases.py
(global discovery) and series/tracked.py (the user's own tracked list):
the next unaired episode, and a season's finale date once it's mid-release."""
from __future__ import annotations

from typing import Any

from app.db.database import get_tmdb_cache, set_tmdb_cache

from ..cache_ttl import DISCOVER_CACHE_TTL
from ..client import _get


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
