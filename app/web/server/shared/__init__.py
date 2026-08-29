"""Shared state, constants, Pydantic bodies, and small helpers used by every
route module in this package.

This used to be a single ~260-line shared.py. It's now split by concern:
  - constants.py    static config values
  - bodies.py       Pydantic request bodies
  - spin_state.py   bounded in-memory spin cooldown / last-title state
  - validation.py   rename/category validation helpers
  - card_data.py     card payload assembly

Everything is re-exported here under its *original* name so existing
`from app.web.server.shared import X` imports keep working unchanged.
"""
from __future__ import annotations

from app.services.card_data import resolve_card_data

from .bodies import (
    DeleteByIdBody,
    DeleteHistoryEntryBody,
    MoveBody,
    RenameBody,
    RenameByIdBody,
    ResolveBody,
    SequelBody,
    SettingBody,
    SkipBody,
    SpinBody,
    TitleBody,
)
from .constants import (
    CATEGORIES,
    CATEGORY_SHORT,
    FEATURED_CACHE_TTL,
    LIST_PAGE_SIZE,
    NOW_PLAYING_MAX_AGE_DAYS,
    ROULETTE_CATEGORIES,
    SPIN_COOLDOWN,
    STATIC_DIR,
    THEATERS_PAGE_SIZE,
    WEB_USER_ID,
    WHEEL_POOL_SIZE,
)
from .spin_state import _SPIN_STATE_MAX_ENTRIES, _BoundedDict, _last_spin_at, _last_spin_title
from .spin_state import build_wheel_pool as _build_wheel_pool
from .spin_state import check_spin_cooldown as _check_spin_cooldown
from .spin_state import client_ip as _client_ip
from .spin_state import pick_title_for_client as _pick_title
from .validation import check_category as _check_category
from .validation import validate_rename as _validate_rename
from .validation import validate_rename_by_id as _validate_rename_by_id


async def _card_data(cat: str, title: str, history_timestamp: float | None = None) -> dict:
    """Assembles the JSON card payload sent to the front end for a title.

    Calls the module-level `resolve_card_data` name (rather than importing
    it inside a helper module) so tests can monkeypatch
    `app.web.server.shared.resolve_card_data` directly, as before this file
    was split into a package.
    """
    data = await resolve_card_data(cat, title)
    info = data["info"]
    display_title = data["title"]
    link = data["watch_link"]

    rating = info.get("rating", "—")
    if isinstance(rating, (int, float)):
        rating = round(rating, 1)

    return {
        "category": cat,
        "title": display_title,
        "original_title": title,
        "overview": info.get("overview", ""),
        "release_date": info.get("release_date", "—"),
        "rating": rating,
        "genres": info.get("genres", "—"),
        "actors": info.get("actors", "—"),
        "runtime": info.get("runtime"),
        "seasons": info.get("seasons"),
        "episodes": info.get("episodes"),
        "poster_url": info.get("poster_url"),
        "watch_link": link,
        "history_timestamp": history_timestamp,
    }

__all__ = [
    "LIST_PAGE_SIZE",
    "THEATERS_PAGE_SIZE",
    "NOW_PLAYING_MAX_AGE_DAYS",
    "CATEGORIES",
    "CATEGORY_SHORT",
    "ROULETTE_CATEGORIES",
    "WEB_USER_ID",
    "STATIC_DIR",
    "SPIN_COOLDOWN",
    "WHEEL_POOL_SIZE",
    "FEATURED_CACHE_TTL",
    "TitleBody",
    "RenameBody",
    "DeleteByIdBody",
    "RenameByIdBody",
    "MoveBody",
    "SequelBody",
    "SpinBody",
    "SkipBody",
    "SettingBody",
    "ResolveBody",
    "DeleteHistoryEntryBody",
    "_check_category",
    "_validate_rename",
    "_validate_rename_by_id",
    "_check_spin_cooldown",
    "_client_ip",
    "_pick_title",
    "_build_wheel_pool",
    "_card_data",
    "_BoundedDict",
    "_SPIN_STATE_MAX_ENTRIES",
    "_last_spin_at",
    "_last_spin_title",
    "resolve_card_data",
]
