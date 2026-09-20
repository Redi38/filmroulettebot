"""Spin endpoints: random spin across movies/cartoons/series, per-category
spin, and the cached "featured" card shown before any spin.

"Рандом" is one wheel over the titles of every roulette list. Marvel/DC have no
roulette of their own, but that wheel and the movies wheel each carry a "Marvel"
and a "DC" lot (see spin_state.py); landing on one shows the first title of that
list. The random wheel's preview/weights endpoints live at `/api/random/...` and
are registered *before* the `/api/{cat}/...` ones, so the literal path wins over
the path parameter.

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

from app.db.database import get_items, get_items_with_ids, get_tmdb_cache, save_history, set_tmdb_cache

from ..shared import (
    FEATURED_CACHE_TTL,
    LOT_CATEGORIES,
    LOT_WHEEL_CATEGORIES,
    RANDOM_WHEEL,
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
    _resolve_wheel_posters,
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


async def _lot_titles() -> tuple[dict[str, str], dict[str, bool | None]]:
    """First title of each non-empty Marvel/DC list — what a lot resolves to —
    plus that title's is_series flag. A franchise with an empty list simply
    has no lot on the wheel. is_series is needed alongside the title because
    a dc/marvel title can be cached under either movie_info or series_info
    (see posters.lookup_poster_info)."""
    lots: dict[str, str] = {}
    lot_is_series: dict[str, bool | None] = {}
    for cat in LOT_CATEGORIES:
        rows = await get_items_with_ids(cat)
        if rows:
            lots[cat] = rows[0]["title"]
            lot_is_series[cat] = rows[0]["is_series"]
    return lots, lot_is_series


async def _lot_wheel_sources(wheel: str) -> tuple[dict[str, list[str]], dict[str, str], dict[str, bool | None]]:
    """Lists and lots behind a wheel that carries Marvel/DC lots: the combined
    random wheel (`wheel == RANDOM_WHEEL`) or a single-list one (movies)."""
    if wheel == RANDOM_WHEEL:
        items_by_cat = await _roulette_items()
    else:
        items = await get_items(wheel)
        items_by_cat = {wheel: items} if items else {}
    lots, lot_is_series = await _lot_titles()
    return items_by_cat, lots, lot_is_series


def _entry_is_series(entry, lot_is_series: dict[str, bool | None]) -> bool | None:
    """is_series for a wheel entry's poster lookup: only meaningful for a
    dc/marvel lot entry (see _lot_titles); every other entry's category
    settles movie-vs-series on its own, so this is None for it."""
    return lot_is_series.get(entry.cat) if entry.cat in LOT_CATEGORIES else None


async def _pool_posters(pool_entries, lot_is_series: dict[str, bool | None]) -> list[str | None]:
    """Cache-only poster URL per segment of a lot-carrying wheel, in pool order."""
    return await _resolve_wheel_posters([(e.cat, e.title, _entry_is_series(e, lot_is_series)) for e in pool_entries])


async def _lot_wheel_preview(wheel: str, weighted: bool, empty_msg: str) -> dict:
    items_by_cat, lots, lot_is_series = await _lot_wheel_sources(wheel)
    entries, weights = _random_entries(items_by_cat, weighted, lots)
    if not entries:
        raise HTTPException(404, empty_msg)
    pool, pool_weights, _, pool_entries = _build_random_wheel_pool(entries, weights)
    posters = await _pool_posters(pool_entries, lot_is_series)
    return {"wheel_pool": pool, "wheel_weights": pool_weights, "wheel_posters": posters}


async def _lot_wheel_weights(wheel: str, body: WheelWeightsBody, empty_msg: str) -> dict:
    items_by_cat, lots, _ = await _lot_wheel_sources(wheel)
    if not items_by_cat and not lots:
        raise HTTPException(404, empty_msg)
    return {"wheel_weights": _random_pool_weights(items_by_cat, body.pool, body.weighted, lots)}


async def _lot_wheel_spin(request: Request, wheel: str, weighted: bool, empty_msg: str) -> dict:
    items_by_cat, lots, lot_is_series = await _lot_wheel_sources(wheel)
    entries, weights = _random_entries(items_by_cat, weighted, lots)
    if not entries:
        raise HTTPException(404, empty_msg)
    winner = _pick_random_entry(_client_ip(request), wheel, entries, weights)
    ts = await save_history(WEB_USER_ID, winner.cat, winner.title)
    data = await _card_data(winner.cat, winner.title, ts)
    data["wheel_pool"], data["wheel_weights"], data["wheel_winner_index"], pool_entries = _build_random_wheel_pool(
        entries, weights, winner
    )
    data["wheel_posters"] = await _pool_posters(pool_entries, lot_is_series)
    return data


_ALL_EMPTY_MSG = "Все три списка пусты — сначала добавь тайтлы"
_EMPTY_LIST_MSG = "Список пуст — добавь тайтлы, чтобы крутить"


@router.get("/api/random/wheel-preview")
async def api_random_wheel_preview(weighted: bool = False) -> dict:
    """Idle pool of the random wheel: every title from every roulette list,
    plus the Marvel/DC lots. Like the per-category preview, no winner is picked
    and nothing is saved."""
    return await _lot_wheel_preview(RANDOM_WHEEL, weighted, _ALL_EMPTY_MSG)


@router.post("/api/random/wheel-weights")
async def api_random_wheel_weights(body: WheelWeightsBody) -> dict:
    """Random-wheel counterpart of `/api/{cat}/wheel-weights`: resize the
    segments already on screen when weighted/normal mode is toggled."""
    return await _lot_wheel_weights(RANDOM_WHEEL, body, _ALL_EMPTY_MSG)


@router.get("/api/{cat}/wheel-preview")
async def api_wheel_preview(cat: str = Depends(valid_category), weighted: bool = False) -> dict:
    """Idle wheel pool for display before the user presses "Крутить" — no
    winner is chosen, no history/cooldown side effects, just titles to show
    on the wheel segments."""
    if cat not in ROULETTE_CATEGORIES:
        raise HTTPException(400, f"{cat} has no roulette — it's a reference list only")
    if cat in LOT_WHEEL_CATEGORIES:
        return await _lot_wheel_preview(cat, weighted, _EMPTY_LIST_MSG)
    items = await get_items(cat)
    if not items:
        raise HTTPException(404, _EMPTY_LIST_MSG)
    dummy = random.choice(items)
    pool, weights = _build_wheel_pool(items, dummy, weighted)
    posters = await _resolve_wheel_posters([(cat, t, None) for t in pool])
    return {"wheel_pool": pool, "wheel_weights": weights, "wheel_posters": posters}


@router.post("/api/{cat}/wheel-weights")
async def api_wheel_weights(body: WheelWeightsBody, cat: str = Depends(valid_category)) -> dict:
    """Recompute segment weights for a wheel pool the client already has on
    screen (see `pool_weights`), so toggling weighted/normal mode can resize
    the existing segments in place instead of rebuilding the wheel with a
    freshly-shuffled pool."""
    if cat not in ROULETTE_CATEGORIES:
        raise HTTPException(400, f"{cat} has no roulette — it's a reference list only")
    if cat in LOT_WHEEL_CATEGORIES:
        return await _lot_wheel_weights(cat, body, _EMPTY_LIST_MSG)
    items = await get_items(cat)
    if not items:
        raise HTTPException(404, _EMPTY_LIST_MSG)
    weights = _pool_weights(items, body.pool, body.weighted)
    return {"wheel_weights": weights}


@router.post("/api/random-spin")
async def api_random_spin(request: Request, body: SpinBody = SpinBody()) -> dict:
    _check_spin_cooldown(_client_ip(request))
    return await _lot_wheel_spin(request, RANDOM_WHEEL, body.weighted, _ALL_EMPTY_MSG)


@router.post("/api/{cat}/spin")
async def api_spin(request: Request, cat: str = Depends(valid_category), body: SpinBody = SpinBody()) -> dict:
    if cat not in ROULETTE_CATEGORIES:
        raise HTTPException(400, f"{cat} has no roulette — it's a reference list only")
    _check_spin_cooldown(_client_ip(request))
    if cat in LOT_WHEEL_CATEGORIES:
        return await _lot_wheel_spin(request, cat, body.weighted, _EMPTY_LIST_MSG)
    items = await get_items(cat)
    if not items:
        raise HTTPException(404, _EMPTY_LIST_MSG)
    title = _pick_title(_client_ip(request), cat, items, body.weighted)
    ts = await save_history(WEB_USER_ID, cat, title)
    data = await _card_data(cat, title, ts)
    data["wheel_pool"], data["wheel_weights"] = _build_wheel_pool(items, title, body.weighted)
    data["wheel_posters"] = await _resolve_wheel_posters([(cat, t, None) for t in data["wheel_pool"]])
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
