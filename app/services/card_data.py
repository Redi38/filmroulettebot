"""Domain logic for resolving a title into TMDB info + a watch link, shared
by the bot (app/routers/roulette/common.py renders it as an HTML card) and
the web frontend (app/web/server/shared.py renders it as JSON). Only the
presentation differs between the two interfaces — the lookup rules below
should stay single-sourced here.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any

from app.services.tmdb import get_movie_info, get_series_info
from app.services.watch_link import find_watch_page_url
from app.utils import build_watch_link

logger = logging.getLogger(__name__)

TMDB_TIMEOUT = 6  # seconds


async def _fetch_tmdb_info(category: str, title: str) -> dict:
    """Pick the right TMDB lookup for `category`. 'dc'/'marvel' aren't split
    into movie/series lists, so they try a movie lookup first and fall back
    to series."""
    try:
        if category == "series":
            return await asyncio.wait_for(get_series_info(title), timeout=TMDB_TIMEOUT) or {}
        if category in ("dc", "marvel"):
            movie = await asyncio.wait_for(get_movie_info(title), timeout=TMDB_TIMEOUT)
            if movie:
                return movie
            return await asyncio.wait_for(get_series_info(title), timeout=TMDB_TIMEOUT) or {}
        return await asyncio.wait_for(get_movie_info(title), timeout=TMDB_TIMEOUT) or {}
    except asyncio.TimeoutError:
        logger.warning("resolve_card_data: TMDB timeout for %r (%s)", title, category)
        return {}


async def resolve_card_data(category: str, title: str) -> dict[str, Any]:
    """Fetch TMDB info and a watch link for `title`.

    Runs the TMDB lookup and an initial watch-link lookup (by the raw
    `title`) concurrently. If TMDB resolves a different display title and
    the first watch-link attempt came up empty, a second attempt is made
    against the resolved display title before falling back to a generic
    search-link builder.

    Returns a neutral dict: {"category", "title" (display title),
    "original_title", "info" (raw TMDB dict), "watch_link"}. Callers format
    this into whatever shape their interface needs (HTML caption for the
    bot, JSON for the web).
    """
    tmdb_task = asyncio.create_task(_fetch_tmdb_info(category, title))
    link_task = asyncio.create_task(find_watch_page_url(title))
    info, direct_link = await asyncio.gather(tmdb_task, link_task)

    display_title = info.get("title", title)
    if direct_link:
        link = direct_link
    elif display_title != title:
        link = await find_watch_page_url(display_title) or build_watch_link(display_title)
    else:
        link = build_watch_link(display_title)

    return {
        "category": category,
        "title": display_title,
        "original_title": title,
        "info": info,
        "watch_link": link,
    }
