"""Spin endpoints: random spin across movies/cartoons/series, per-category
spin, and the cached "featured" card shown before any spin.

"Рандом" is one wheel over the titles of every roulette list (Marvel/DC are
reference-only and are not part of it). Its preview/weights endpoints live at
`/api/random/...` and are registered *before* the `/api/{cat}/...` ones, so the
literal path wins over the path parameter.

The featured card is cached in the `tmdb_cache` SQLite table (the same
persistent cache TMDB lookups and posters use — see app/db/database/cache.py)
rather than an in-process dict. Unlike the cooldown/last-title bookkeeping in
shared.py, this cache is expensive to rebuild (it triggers TMDb lookups), so
losing it on every uvicorn restart (deploy, healthcheck-restart) is worth
avoiding — persisting it means a redeploy doesn't force a fresh TMDb round
trip for the first visitor after every restart."""
from __future__ import annotations

import random

from fastapi import APIRouter, Depends, HTTPException, Request

from app.db.database import get_items, get_tmdb_cache, save_history, set_tmdb_cache

from ..shared import (
    FEATURED_CACHE_TTL,
    ROULETTE_CATEGORIES,
    WEB_USER_ID,
    SpinBody,
    WheelWeightsBody,
    _build_random_wheel_pool,
    _build_wheel_pool,
    _card_data,
    _check_spin_cooldown,
    _client_ip,
    _pick_random_entry,
    _pick_title,
    _pool_weights,
    _random_entries,
    _random_pool_weights,
    valid_category,
)

router = APIRouter()


async def _roulette_items() -> dict[str, list[str]]:
    """Non-empty roulette lists by category — the source of the random wheel."""
    items_by_cat: dict[str, list[str]] = {}
    for cat in ROULETTE_CATEGORIES:
        items = await get_items(cat)
        if items:
            items_by_cat[cat] = items
    return items_by_cat


@router.get("/api/random/wheel-preview")
async def api_random_wheel_preview(weighted: bool = False) -> dict:
    """Idle pool of the random wheel: every title from every roulette list.
    Like the per-category preview, no winner is picked and nothing is saved."""
    items_by_cat = await _roulette_items()
    if not items_by_cat:
        raise HTTPException(404, "Все три списка пусты — сначала добавь тайтлы")
    entries, weights = _random_entries(items_by_cat, weighted)
    pool, pool_weights = _build_random_wheel_pool(entries, weights)
    return {"wheel_pool": pool, "wheel_weights": pool_weights}


@router.post("/api/random/wheel-weights")
async def api_random_wheel_weights(body: WheelWeightsBody) -> dict:
    """Random-wheel counterpart of `/api/{cat}/wheel-weights`: resize the
    segments already on screen when weighted/normal mode is toggled."""
    items_by_cat = await _roulette_items()
    if not items_by_cat:
        raise HTTPException(404, "Все три списка пусты — сначала добавь тайтлы")
    return {"wheel_weights": _random_pool_weights(items_by_cat, body.pool, body.weighted)}


@router.get("/api/{cat}/wheel-preview")
async def api_wheel_preview(cat: str = Depends(valid_category), weighted: bool = False) -> dict:
    """Idle wheel pool for display before the user presses "Крутить" — no
    winner is chosen, no history/cooldown side effects, just titles to show
    on the wheel segments."""
    if cat not in ROULETTE_CATEGORIES:
        raise HTTPException(400, f"{cat} has no roulette — it's a reference list only")
    items = await get_items(cat)
    if not items:
        raise HTTPException(404, "Список пуст — добавь тайтлы, чтобы крутить")
    dummy = random.choice(items)
    pool, weights = _build_wheel_pool(items, dummy, weighted)
    return {"wheel_pool": pool, "wheel_weights": weights}


@router.post("/api/{cat}/wheel-weights")
async def api_wheel_weights(body: WheelWeightsBody, cat: str = Depends(valid_category)) -> dict:
    """Recompute segment weights for a wheel pool the client already has on
    screen (see `pool_weights`), so toggling weighted/normal mode can resize
    the existing segments in place instead of rebuilding the wheel with a
    freshly-shuffled pool."""
    if cat not in ROULETTE_CATEGORIES:
        raise HTTPException(400, f"{cat} has no roulette — it's a reference list only")
    items = await get_items(cat)
    if not items:
        raise HTTPException(404, "Список пуст — добавь тайтлы, чтобы крутить")
    weights = _pool_weights(items, body.pool, body.weighted)
    return {"wheel_weights": weights}


@router.post("/api/random-spin")
async def api_random_spin(request: Request, body: SpinBody = SpinBody()) -> dict:
    _check_spin_cooldown(_client_ip(request))
    items_by_cat = await _roulette_items()
    if not items_by_cat:
        raise HTTPException(404, "Все три списка пусты — сначала добавь тайтлы")
    entries, weights = _random_entries(items_by_cat, body.weighted)
    winner = _pick_random_entry(_client_ip(request), entries, weights)
    cat, title = winner
    ts = await save_history(WEB_USER_ID, cat, title)
    data = await _card_data(cat, title, ts)
    data["wheel_pool"], data["wheel_weights"] = _build_random_wheel_pool(entries, weights, winner)
    return data


@router.post("/api/{cat}/spin")
async def api_spin(request: Request, cat: str = Depends(valid_category), body: SpinBody = SpinBody()) -> dict:
    if cat not in ROULETTE_CATEGORIES:
        raise HTTPException(400, f"{cat} has no roulette — it's a reference list only")
    _check_spin_cooldown(_client_ip(request))
    items = await get_items(cat)
    if not items:
        raise HTTPException(404, "Список пуст — добавь тайтлы, чтобы крутить")
    title = _pick_title(_client_ip(request), cat, items, body.weighted)
    ts = await save_history(WEB_USER_ID, cat, title)
    data = await _card_data(cat, title, ts)
    data["wheel_pool"], data["wheel_weights"] = _build_wheel_pool(items, title, body.weighted)
    return data


@router.get("/api/{cat}/featured")
async def api_featured(cat: str = Depends(valid_category)) -> dict:
    items = await get_items(cat)
    if not items:
        raise HTTPException(404, "Список пуст — добавь тайтлы, чтобы крутить")
    first = items[0]

    cache_key = f"featured:{cat}:{first}"
    cached = await get_tmdb_cache(cache_key, FEATURED_CACHE_TTL)
    if cached is not None:
        return cached

    data = await _card_data(cat, first)
    await set_tmdb_cache(cache_key, data)
    return data
