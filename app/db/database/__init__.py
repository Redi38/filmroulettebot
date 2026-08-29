"""Async SQLite layer using aiosqlite.

Split by concern into sibling modules (connection/schema/items/cache/
history/upcoming/skipped); this file re-exports the same public names the
old single-file app/db/database.py exposed, so `from app.db.database import
...` call sites elsewhere in the app don't need to change.
"""
from __future__ import annotations

from .cache import get_tmdb_cache, set_tmdb_cache
from .connection import close_db
from .history import (
    clear_all_history,
    clear_history_category,
    clear_user_history,
    delete_history_entry,
    get_recent_history,
    load_history,
    resolve_history_entry,
    save_history,
)
from .items import (
    add_item,
    delete_item,
    delete_item_by_id,
    get_items,
    get_items_with_ids,
    item_exists,
    item_exists_other_id,
    rename_item,
    rename_item_by_id,
)
from .schema import init_db
from .skipped import SKIP_SCOPES, add_skipped, get_skipped, remove_skipped
from .upcoming import (
    add_upcoming_movie,
    delete_upcoming_movie,
    delete_upcoming_movie_by_id,
    get_upcoming_movies,
    get_upcoming_movies_with_ids,
    rename_upcoming_movie,
    rename_upcoming_movie_by_id,
    upcoming_title_taken_by_other,
)

__all__ = [
    "init_db",
    "close_db",
    "get_items",
    "get_items_with_ids",
    "item_exists",
    "item_exists_other_id",
    "add_item",
    "delete_item",
    "delete_item_by_id",
    "rename_item",
    "rename_item_by_id",
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
    "get_upcoming_movies",
    "get_upcoming_movies_with_ids",
    "add_upcoming_movie",
    "delete_upcoming_movie",
    "delete_upcoming_movie_by_id",
    "rename_upcoming_movie",
    "rename_upcoming_movie_by_id",
    "upcoming_title_taken_by_other",
    "SKIP_SCOPES",
    "get_skipped",
    "add_skipped",
    "remove_skipped",
]
