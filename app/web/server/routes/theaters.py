"""Global TMDb theatrical calendar (now playing / upcoming) and the global
"series releasing soon" list, plus the skip/unskip action shared by both
tabs (they show TMDb discovery data, not the user's own lists). App-wide
settings used here (e.g. the local-only filter) live in settings.py."""
from __future__ import annotations

import asyncio
import time
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, HTTPException, Response

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

from ..shared.bodies import SkipBody
from ..shared.constants import NOW_PLAYING_MAX_AGE_DAYS, THEATERS_PAGE_SIZE

router = APIRouter()

_THEATERS_CACHE_CONTROL = "private, max-age=45, stale-while-revalidate=180"

ORDERS = ("default", "date")


def _ordered(items: list[dict[str, Any]], order: str) -> list[dict[str, Any]]:
    """Optionally re-sort a listing by release date, ascending.

    This exists for the "По дням" view. Both theatrical listings arrive
    in TMDb's popularity order, so slicing them into pages and then
    grouping each page by day gave every page its own calendar starting
    from that page's earliest date — page 2 read as a restart of page 1
    rather than a continuation. Ordering has to happen here, across the
    whole list, because paginate() runs below.

    Undated entries sort last rather than first, which an empty string
    would otherwise do.
    """
    if order not in ORDERS:
        raise HTTPException(400, f"Unknown order: {order!r}")
    if order != "date":
        return items
    return sorted(items, key=lambda m: (not m.get("release_date"), m.get("release_date") or ""))

_PROCESSED_CACHE_TTL = 300
_processed_cache: dict[str, tuple[list[dict[str, Any]], float]] = {}


async def _get_processed_now_playing(hide_local_only: bool) -> list[dict[str, Any]]:
    key = f"now_playing:{hide_local_only}"
    cached = _processed_cache.get(key)
    if cached is not None and time.monotonic() - cached[1] < _PROCESSED_CACHE_TTL:
        return cached[0]

    now_playing = await get_now_playing()
    cutoff = (datetime.now(timezone.utc) - timedelta(days=NOW_PLAYING_MAX_AGE_DAYS)).strftime("%Y-%m-%d")
    now_playing = [m for m in now_playing if m.get("release_date", "") >= cutoff]
    if hide_local_only:
        now_playing = await filter_globally_released(now_playing)

    with_id = [m for m in now_playing if m.get("id")]
    digitally_released = await asyncio.gather(
        *(is_digitally_released(m["id"], m["release_date"]) for m in with_id)
    )
    for m, flag in zip(with_id, digitally_released):
        m["digitally_released"] = flag

    _processed_cache[key] = (now_playing, time.monotonic())
    return now_playing


async def _get_processed_upcoming(hide_local_only: bool) -> list[dict[str, Any]]:
    key = f"upcoming:{hide_local_only}"
    cached = _processed_cache.get(key)
    if cached is not None and time.monotonic() - cached[1] < _PROCESSED_CACHE_TTL:
        return cached[0]

    upcoming = await get_upcoming_theatrical()
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    upcoming = [m for m in upcoming if m.get("release_date", "") >= today]
    if hide_local_only:
        upcoming = await filter_globally_released(upcoming)

    _processed_cache[key] = (upcoming, time.monotonic())
    return upcoming


@router.get("/api/theaters")
async def api_theaters(
    response: Response,
    now_playing_page: int = 1,
    upcoming_page: int = 1,
    added: str = "all",
    hide_local_only: bool | None = None,
    digital: str = "all",
    order: str = "default",
) -> dict:
    """TMDb's own "now playing" / "upcoming" theatrical calendars — global,
    not tied to any studio, unlike /api/showcase/{studio}. Movies and
    cartoons only; series live on their own /api/series-releases tab.

    hide_local_only mirrors the "hide_local_only_afisha" setting and is
    normally passed explicitly by the front end (which already loads that
    setting to draw the toggle button) — that's what makes this request's
    URL actually change when the toggle changes, which matters because this
    endpoint sets a client-cacheable Cache-Control header: an identical URL
    before/after flipping the setting would otherwise let the *browser's*
    HTTP cache silently keep serving the pre-toggle response for up to 45s,
    no matter what the DB setting says. When the param is omitted (older
    cached pages, non-browser callers), fall back to reading the setting
    from the DB as before.

    `digital` is applied here rather than in the browser because this
    endpoint paginates: narrowing a page the server had already cut to
    THEATERS_PAGE_SIZE would leave the page counter describing the
    unfiltered list. `order` is here for the same reason — see _ordered().
    """
    response.headers["Cache-Control"] = _THEATERS_CACHE_CONTROL
    if hide_local_only is None:
        hide_local_only = await get_bool_setting("hide_local_only_afisha")
    (now_playing, upcoming), (own_movies, own_cartoons, own_upcoming, skipped_now, skipped_upcoming) = (
        await asyncio.gather(
            asyncio.gather(
                _get_processed_now_playing(hide_local_only),
                _get_processed_upcoming(hide_local_only),
            ),
            asyncio.gather(
                get_items("movies"),
                get_items("cartoons"),
                get_upcoming_movies(),
                get_skipped("theaters_now_playing"),
                get_skipped("theaters_upcoming"),
            ),
        )
    )

    skipped_now_set = {t.lower() for t in skipped_now}
    skipped_upcoming_set = {t.lower() for t in skipped_upcoming}
    now_playing = [m for m in now_playing if m["title"].lower() not in skipped_now_set]
    upcoming = [m for m in upcoming if m["title"].lower() not in skipped_upcoming_set]

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

    # "Уже в цифре" / "Только в кино" is a now-playing-only distinction:
    # nothing in the upcoming column has a digital release yet by
    # definition, so the filter deliberately doesn't touch that list.
    if digital == "digital":
        now_playing = [m for m in now_playing if m.get("digitally_released")]
    elif digital == "cinema":
        now_playing = [m for m in now_playing if not m.get("digitally_released")]
    elif digital != "all":
        raise HTTPException(400, f"Unknown digital filter: {digital!r}")

    now_playing_items, now_playing_page, now_playing_total_pages = paginate(
        _ordered(now_playing, order), now_playing_page, THEATERS_PAGE_SIZE
    )
    upcoming_items, upcoming_page, upcoming_total_pages = paginate(
        _ordered(upcoming, order), upcoming_page, THEATERS_PAGE_SIZE
    )
    return {
        "now_playing": now_playing_items,
        "now_playing_page": now_playing_page,
        "now_playing_total_pages": now_playing_total_pages,
        "upcoming": upcoming_items,
        "upcoming_page": upcoming_page,
        "upcoming_total_pages": upcoming_total_pages,
    }


SERIES_STATUSES = ("all", "new_series", "new_season", "airing")


@router.get("/api/series-releases")
async def api_series_releases(
    response: Response, page: int = 1, added: str = "all", status: str = "all", order: str = "default"
) -> dict:
    """Popular TV shows airing new seasons/episodes soon — global TMDb
    discovery (not tied to the user's own series list), separate from the
    movies/cartoons-only /api/theaters tab. Rating 7+ only.

    `status` narrows by what kind of premiere a row actually is — a
    debuting show, the start of a new season, or a season already midway
    through airing. The date line has always distinguished the three
    visually, but nothing could filter on them. As with `digital` on
    /api/theaters, this runs before paginate() so the page counter keeps
    describing the list actually being shown."""
    response.headers["Cache-Control"] = _THEATERS_CACHE_CONTROL
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

    if status not in SERIES_STATUSES:
        raise HTTPException(400, f"Unknown status: {status!r}")
    if status == "new_series":
        releases = [m for m in releases if m.get("is_new_series")]
    elif status == "new_season":
        releases = [m for m in releases if m.get("is_new_season")]
    elif status == "airing":
        releases = [m for m in releases if m.get("airing_now")]

    items, page, total_pages = paginate(_ordered(releases, order), page, THEATERS_PAGE_SIZE)
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
