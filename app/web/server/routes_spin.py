"""Spin endpoints: random spin across movies/cartoons/series, per-category
spin, and the cached "featured" card shown before any spin."""
from __future__ import annotations

import random
import time

from fastapi import APIRouter, HTTPException, Request

from app.db.database import get_items, save_history

from .shared import (
    FEATURED_CACHE_TTL,
    ROULETTE_CATEGORIES,
    WEB_USER_ID,
    _build_wheel_pool,
    _card_data,
    _check_category,
    _check_spin_cooldown,
    _client_ip,
    _featured_cache,
    _pick_title,
)

router = APIRouter()


@router.post("/api/random-spin")
async def api_random_spin(request: Request) -> dict:
    _check_spin_cooldown(_client_ip(request))
    non_empty = [c for c in ROULETTE_CATEGORIES if await get_items(c)]
    if not non_empty:
        raise HTTPException(404, "All three roulettes are empty")
    cat = random.choice(non_empty)
    items = await get_items(cat)
    title = _pick_title(_client_ip(request), cat, items)
    ts = await save_history(WEB_USER_ID, cat, title)
    data = await _card_data(cat, title, ts)
    data["wheel_pool"] = _build_wheel_pool(items, title)
    return data


@router.post("/api/{cat}/spin")
async def api_spin(cat: str, request: Request) -> dict:
    _check_category(cat)
    if cat not in ROULETTE_CATEGORIES:
        raise HTTPException(400, f"{cat} has no roulette — it's a reference list only")
    _check_spin_cooldown(_client_ip(request))
    items = await get_items(cat)
    if not items:
        raise HTTPException(404, "List is empty")
    title = _pick_title(_client_ip(request), cat, items)
    ts = await save_history(WEB_USER_ID, cat, title)
    data = await _card_data(cat, title, ts)
    data["wheel_pool"] = _build_wheel_pool(items, title)
    return data


@router.get("/api/{cat}/featured")
async def api_featured(cat: str) -> dict:
    _check_category(cat)
    items = await get_items(cat)
    if not items:
        raise HTTPException(404, "List is empty")
    first = items[0]

    cache_key = f"{cat}:{first}"
    cached = _featured_cache.get(cache_key)
    if cached is not None:
        data, expires_at = cached
        if time.monotonic() < expires_at:
            return data
        del _featured_cache[cache_key]

    data = await _card_data(cat, first)
    _featured_cache[cache_key] = (data, time.monotonic() + FEATURED_CACHE_TTL)
    return data
