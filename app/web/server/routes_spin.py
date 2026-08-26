"""Spin endpoints: random spin across movies/cartoons/series, per-category
spin, and the cached "featured" card shown before any spin.

The featured card is cached in the `tmdb_cache` SQLite table (the same
persistent cache TMDB lookups and posters use — see app/db/database/cache.py)
rather than an in-process dict. Unlike the cooldown/last-title bookkeeping in
shared.py, this cache is expensive to rebuild (it triggers TMDb lookups), so
losing it on every uvicorn restart (deploy, healthcheck-restart) is worth
avoiding — persisting it means a redeploy doesn't force a fresh TMDb round
trip for the first visitor after every restart."""
from __future__ import annotations

import random

from fastapi import APIRouter, HTTPException, Request

from app.db.database import get_items, get_tmdb_cache, save_history, set_tmdb_cache

from .shared import (
    FEATURED_CACHE_TTL,
    ROULETTE_CATEGORIES,
    WEB_USER_ID,
    SpinBody,
    _build_wheel_pool,
    _card_data,
    _check_category,
    _check_spin_cooldown,
    _client_ip,
    _pick_title,
)

router = APIRouter()


@router.get("/api/{cat}/wheel-preview")
async def api_wheel_preview(cat: str, weighted: bool = False) -> dict:
    """Idle wheel pool for display before the user presses "Крутить" — no
    winner is chosen, no history/cooldown side effects, just titles to show
    on the wheel segments."""
    _check_category(cat)
    if cat not in ROULETTE_CATEGORIES:
        raise HTTPException(400, f"{cat} has no roulette — it's a reference list only")
    items = await get_items(cat)
    if not items:
        raise HTTPException(404, "List is empty")
    dummy = random.choice(items)
    pool, weights = _build_wheel_pool(items, dummy, weighted)
    return {"wheel_pool": pool, "wheel_weights": weights}


@router.post("/api/random-spin")
async def api_random_spin(request: Request, body: SpinBody = SpinBody()) -> dict:
    _check_spin_cooldown(_client_ip(request))
    non_empty = [c for c in ROULETTE_CATEGORIES if await get_items(c)]
    if not non_empty:
        raise HTTPException(404, "All three roulettes are empty")
    cat = random.choice(non_empty)
    items = await get_items(cat)
    title = _pick_title(_client_ip(request), cat, items, body.weighted)
    ts = await save_history(WEB_USER_ID, cat, title)
    data = await _card_data(cat, title, ts)
    data["wheel_pool"], data["wheel_weights"] = _build_wheel_pool(items, title, body.weighted)
    return data


@router.post("/api/{cat}/spin")
async def api_spin(cat: str, request: Request, body: SpinBody = SpinBody()) -> dict:
    _check_category(cat)
    if cat not in ROULETTE_CATEGORIES:
        raise HTTPException(400, f"{cat} has no roulette — it's a reference list only")
    _check_spin_cooldown(_client_ip(request))
    items = await get_items(cat)
    if not items:
        raise HTTPException(404, "List is empty")
    title = _pick_title(_client_ip(request), cat, items, body.weighted)
    ts = await save_history(WEB_USER_ID, cat, title)
    data = await _card_data(cat, title, ts)
    data["wheel_pool"], data["wheel_weights"] = _build_wheel_pool(items, title, body.weighted)
    return data


@router.get("/api/{cat}/featured")
async def api_featured(cat: str) -> dict:
    _check_category(cat)
    items = await get_items(cat)
    if not items:
        raise HTTPException(404, "List is empty")
    first = items[0]

    cache_key = f"featured:{cat}:{first}"
    cached = await get_tmdb_cache(cache_key, FEATURED_CACHE_TTL)
    if cached is not None:
        return cached

    data = await _card_data(cat, first)
    await set_tmdb_cache(cache_key, data)
    return data
