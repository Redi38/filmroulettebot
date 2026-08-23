"""Async SQLite layer using aiosqlite.

Split by concern into sibling modules (connection/schema/items/cache/
history/upcoming/skipped); this file re-exports the same public names the
old single-file app/db/database.py exposed, so `from app.db.database import
...` call sites elsewhere in the app don't need to change.
"""
from __future__ import annotations

from .cache import get_tmdb_cache, set_tmdb_cache
from .history import (
    clear_all_history,
    clear_history_category,
    clear_user_history,
    delete_history_entry,
    get_recent_history,
    get_stats,
    load_history,
    resolve_history_entry,
    save_history,
)
from .items import add_item, delete_item, get_items, item_exists, rename_item
from .schema import init_db
from .skipped import SKIP_SCOPES, add_skipped, get_skipped, remove_skipped
from .upcoming import (
    add_upcoming_movie,
    delete_upcoming_movie,
    get_upcoming_movies,
    rename_upcoming_movie,
)

__all__ = [
    "init_db",
    "get_items",
    "item_exists",
    "add_item",
    "delete_item",
    "rename_item",
    "get_tmdb_cache",
    "set_tmdb_cache",
    "load_history",
    "get_recent_history",
    "save_history",
    "resolve_history_entry",
    "clear_user_history",
    "clear_all_history",
    "clear_history_category",
    "delete_history_entry",
    "get_stats",
    "get_upcoming_movies",
    "add_upcoming_movie",
    "delete_upcoming_movie",
    "rename_upcoming_movie",
    "SKIP_SCOPES",
    "get_skipped",
    "add_skipped",
    "remove_skipped",
]
