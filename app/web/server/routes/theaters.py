"""Global TMDb theatrical calendar (now playing / upcoming) and the global
"series releasing soon" list, plus the skip/unskip action shared by both
tabs (they show TMDb discovery data, not the user's own lists). App-wide
settings used here (e.g. the local-only filter) live in settings.py."""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException

from app.db.database import (
    SKIP_SCOPES,
    add_skipped,
    get_bool_setting,
    get_items,
    get_skipped,
    get_upcoming_movies,
    remove_skipped,
)
from app.services.tmdb import (
    filter_globally_released,
    get_now_playing,
    get_series_releases,
    get_upcoming_theatrical,
    is_digitally_released,
)
from app.utils import paginate

from ..shared import NOW_PLAYING_MAX_AGE_DAYS, THEATERS_PAGE_SIZE, SkipBody

router = APIRouter()


@router.get("/api/theaters")
async def api_theaters(now_playing_page: int = 1, upcoming_page: int = 1, added: str = "all") -> dict:
    """TMDb's own "now playing" / "upcoming" theatrical calendars — global,
    not tied to any studio, unlike /api/showcase/{studio}. Movies and
    cartoons only; series live on their own /api/series-releases tab."""
    (now_playing, upcoming), (own_movies, own_cartoons, own_upcoming, skipped_now, skipped_upcoming) = (
        await asyncio.gather(
            asyncio.gather(get_now_playing(), get_upcoming_theatrical()),
            asyncio.gather(
                get_items("movies"),
                get_items("cartoons"),
                get_upcoming_movies(),
                get_skipped("theaters_now_playing"),
                get_skipped("theaters_upcoming"),
            ),
        )
    )

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    cutoff = (datetime.now(timezone.utc) - timedelta(days=NOW_PLAYING_MAX_AGE_DAYS)).strftime("%Y-%m-%d")
    now_playing = [m for m in now_playing if m.get("release_date", "") >= cutoff]
    upcoming = [m for m in upcoming if m.get("release_date", "") >= today]

    skipped_now_set = {t.lower() for t in skipped_now}
    skipped_upcoming_set = {t.lower() for t in skipped_upcoming}
    now_playing = [m for m in now_playing if m["title"].lower() not in skipped_now_set]
    upcoming = [m for m in upcoming if m["title"].lower() not in skipped_upcoming_set]

    if await get_bool_setting("hide_local_only_afisha"):
        now_playing, upcoming = await asyncio.gather(
            filter_globally_released(now_playing), filter_globally_released(upcoming)
        )

    own_all = {t.lower() for t in (*own_movies, *own_cartoons)}
    own_upcoming_set = {t.lower() for t in own_upcoming}
    for m in now_playing:
        m["in_list"] = m["title"].lower() in own_all
    for m in upcoming:
        m["in_list"] = m["title"].lower() in own_upcoming_set

    if added == "hide":
        now_playing = [m for m in now_playing if not m["in_list"]]
        upcoming = [m for m in upcoming if not m["in_list"]]
    elif added == "only":
        now_playing = [m for m in now_playing if m["in_list"]]
        upcoming = [m for m in upcoming if m["in_list"]]

    with_id = [m for m in now_playing if m.get("id")]
    digitally_released = await asyncio.gather(
        *(is_digitally_released(m["id"], m["release_date"]) for m in with_id)
    )
    for m, flag in zip(with_id, digitally_released):
        m["digitally_released"] = flag

    now_playing_items, now_playing_page, now_playing_total_pages = paginate(
        now_playing, now_playing_page, THEATERS_PAGE_SIZE
    )
    upcoming_items, upcoming_page, upcoming_total_pages = paginate(
        upcoming, upcoming_page, THEATERS_PAGE_SIZE
    )
    return {
        "now_playing": now_playing_items,
        "now_playing_page": now_playing_page,
        "now_playing_total_pages": now_playing_total_pages,
        "upcoming": upcoming_items,
        "upcoming_page": upcoming_page,
        "upcoming_total_pages": upcoming_total_pages,
    }


@router.get("/api/series-releases")
async def api_series_releases(page: int = 1, added: str = "all") -> dict:
    """Popular TV shows airing new seasons/episodes soon — global TMDb
    discovery (not tied to the user's own series list), separate from the
    movies/cartoons-only /api/theaters tab. Rating 7+ only."""
    releases, own_series, skipped = await asyncio.gather(
        get_series_releases(), get_items("series"), get_skipped("series_releases"),
    )
    releases = [m for m in releases if isinstance(m.get("rating"), (int, float)) and m["rating"] >= 7]
    skipped_set = {t.lower() for t in skipped}
    releases = [m for m in releases if (m.get("title") or "").strip().lower() not in skipped_set]
    own_series_set = {t.lower() for t in own_series}
    for m in releases:
        m["in_list"] = (m.get("title") or "").strip().lower() in own_series_set
    if added == "hide":
        releases = [m for m in releases if not m["in_list"]]
    elif added == "only":
        releases = [m for m in releases if m["in_list"]]
    items, page, total_pages = paginate(releases, page, THEATERS_PAGE_SIZE)
    return {"releases": items, "page": page, "total_pages": total_pages}


@router.post("/api/skip")
async def api_skip(body: SkipBody) -> dict:
    """Hide a title from Афиша/Премьеры сериалов — it's not user-list data
    (these tabs show global TMDb discovery, not the user's own titles), so
    "not interested" is tracked separately per tab via skipped_titles."""
    if body.scope not in SKIP_SCOPES:
        raise HTTPException(400, f"Unknown skip scope: {body.scope!r}")
    await add_skipped(body.scope, body.title)
    return {"ok": True}


@router.post("/api/unskip")
async def api_unskip(body: SkipBody) -> dict:
    if body.scope not in SKIP_SCOPES:
        raise HTTPException(400, f"Unknown skip scope: {body.scope!r}")
    await remove_skipped(body.scope, body.title)
    return {"ok": True}
