"""Home screen ('Афиша'): poster set for the 'Твоя коллекция' running
marquee, built entirely from titles already in the user's own lists.

Deliberately cache-only: it never calls the TMDb service functions
(get_movie_info/get_series_info), which would hit the network on a miss.
Instead it reads app.db.database's tmdb_cache table directly, so a title
that was never resolved elsewhere (spin/list/showcase/etc.) is simply
skipped rather than triggering a fresh lookup. Posters don't go stale in
any meaningful sense, so the TTL here is generous — this is about
maximizing cache hits, not freshness.
"""
from __future__ import annotations

import random

from fastapi import APIRouter, HTTPException

from app.db.database import get_items_with_ids, item_exists

from ..shared import _card_data, _check_category
from ..shared.posters import FRANCHISE_CATEGORIES, lookup_poster_info

router = APIRouter()

COLLECTION_CATEGORIES = ("movies", "cartoons", "series")

_MAX_POSTERS = 80


@router.get("/api/home/collection")
async def api_home_collection() -> dict:
    # get_items_with_ids rather than get_items for the sake of each row's
    # is_series flag: a dc/marvel title can exist as both a film and a show
    # ("Фонари"), and without the flag lookup_poster_info guesses movie
    # first — which put the film's poster on the Афиша for a row the user
    # had picked the series for.
    pairs: list[tuple[str, str, bool | None]] = []
    for cat in (*COLLECTION_CATEGORIES, *FRANCHISE_CATEGORIES):
        for item in await get_items_with_ids(cat):
            pairs.append((cat, item["title"], item.get("is_series")))

    total_items = len(pairs)
    random.shuffle(pairs)

    posters: list[dict] = []
    for cat, title, is_series in pairs:
        if len(posters) >= _MAX_POSTERS:
            break
        info = await lookup_poster_info(cat, title, is_series)
        if not info:
            continue
        posters.append({
            "title": info.get("title") or title,
            "original_title": title,
            "poster_url": info["poster_url"],
            "category": cat,
        })

    return {"posters": posters, "total_items": total_items}


@router.get("/api/home/card")
async def api_home_card(category: str, title: str) -> dict:
    """Full card info for a poster tapped in the 'Афиша' marquee — same
    shape as the spin/list-featured cards, minus spin actions (the poster
    is just something the user already has in a list, not a fresh pick).
    `title` here must be the raw title as stored in the DB (the marquee's
    `original_title`), not the TMDb-resolved display title — those can
    differ (translated/alternate titles) and item_exists checks the raw
    table."""
    _check_category(category)
    if not await item_exists(category, title):
        raise HTTPException(404, "Title not found in this category")
    return await _card_data(category, title)
