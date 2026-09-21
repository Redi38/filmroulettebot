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

from ..shared.card import card_data
from ..shared.posters import FRANCHISE_CATEGORIES, lookup_poster_info_many
from ..shared.validation import check_category

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
    pairs_by_cat: dict[str, list[tuple[str, bool | None]]] = {}
    total_items = 0
    for cat in (*COLLECTION_CATEGORIES, *FRANCHISE_CATEGORIES):
        rows = [(item["title"], item.get("is_series")) for item in await get_items_with_ids(cat)]
        pairs_by_cat[cat] = rows
        total_items += len(rows)

    # One batched tmdb_cache lookup per category instead of one (or two,
    # for dc/marvel) awaited SELECT per title — with every title in every
    # list in play here, the old per-title loop was the single biggest
    # contributor to this endpoint's latency.
    posters: list[dict] = []
    for cat, rows in pairs_by_cat.items():
        info_by_title = await lookup_poster_info_many(cat, rows)
        for title, _is_series in rows:
            info = info_by_title.get(title)
            if not info:
                continue
            posters.append({
                "title": info.get("title") or title,
                "original_title": title,
                "poster_url": info["poster_url"],
                "category": cat,
            })

    random.shuffle(posters)
    posters = posters[:_MAX_POSTERS]

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
    check_category(category)
    if not await item_exists(category, title):
        raise HTTPException(404, "Title not found in this category")
    return await card_data(category, title)
