"""Next-episode / season-finale status resolution for the user's own
personally tracked series list (added by name) — see releases.py for the
global, list-independent equivalent."""
from __future__ import annotations

import asyncio
from typing import Any

from ..helpers import best_match, poster
from .episodes import get_season_finale_date, get_tv_next_episode
from .search import _search_tv_cached


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
