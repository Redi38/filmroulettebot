"""Small validation helpers shared by the item/list route modules."""
from __future__ import annotations

from fastapi import Depends, HTTPException

from .constants import CATEGORIES, ROULETTE_CATEGORIES


def check_category(cat: str) -> None:
    if cat not in CATEGORIES:
        raise HTTPException(404, f"Unknown category: {cat}")


async def valid_category(cat: str) -> str:
    """FastAPI dependency form of check_category(), for handlers whose
    category comes from the `{cat}` path segment: `cat: str =
    Depends(valid_category)` replaces the `cat: str` param + a manual
    `check_category(cat)` call in the body, since FastAPI resolves this
    dependency's own `cat` argument from that same path segment.

    Only fits path-param routes. A category read from a request body field
    (e.g. MoveBody.category) can't be wired through Depends this way —
    those handlers still call check_category(body.category) directly."""
    check_category(cat)
    return cat


async def roulette_category(cat: str = Depends(valid_category)) -> str:
    """`valid_category` narrowed to the categories that have a roulette. Marvel
    and DC are reference lists only, so the spin/wheel endpoints reject them
    with a 400 (a known category, just not one you can spin)."""
    if cat not in ROULETTE_CATEGORIES:
        raise HTTPException(400, f"{cat} has no roulette — it's a reference list only")
    return cat


async def add_or_conflict(exists_fn, add_fn, title: str, conflict_msg: str) -> str:
    """Shared validate-then-add for the three list "add a title" endpoints
    (items.py, upcoming.py, tracked_series.py): strip the title, reject an
    empty or already-present one, then call add_fn(title). Returns the
    stripped title so callers can do post-add work (e.g. caching a tmdb id)
    without re-stripping body.title themselves.

    exists_fn/add_fn are pre-bound to whatever category/table the caller's
    endpoint is for (a lambda or partial) — this only owns the check/raise
    sequence all three shared, not the underlying storage call."""
    title = title.strip()
    if not title:
        raise HTTPException(400, "Title can't be empty")
    if await exists_fn(title):
        raise HTTPException(409, conflict_msg)
    await add_fn(title)
    return title


async def validate_rename(
    exists_fn, old_title: str, new_title: str, category_label: str,
    conflict_msg: str | None = None,
) -> bool:
    """Shared rename validation: empty check, no-op check, existence and
    conflict checks. Returns True if the caller should proceed with the
    rename, False if it's a no-op (old_title == new_title)."""
    if not new_title:
        raise HTTPException(400, "Title can't be empty")
    if new_title == old_title:
        return False
    if not await exists_fn(old_title):
        raise HTTPException(404, f"«{old_title}» не найден(а)")
    if await exists_fn(new_title):
        raise HTTPException(409, conflict_msg or f"«{new_title}» уже добавлен(а) в «{category_label}»")
    return True


async def validate_rename_by_id(
    conflict_exists_fn, item_id: int, new_title: str,
    conflict_msg: str,
) -> bool:
    """Id-based counterpart of validate_rename(): the row is identified by
    id (so it can't silently miss if another request already renamed it —
    see get_items_with_ids()'s docstring), and the conflict check excludes
    the row's own id so renaming "Foo" -> "Foo" (or a no-op case change)
    doesn't falsely report a conflict with itself. Returns True if the
    caller should proceed, False if new_title is empty after stripping
    (nothing to do, caller should just no-op)."""
    if not new_title:
        raise HTTPException(400, "Title can't be empty")
    if await conflict_exists_fn(new_title, item_id):
        raise HTTPException(409, conflict_msg)
    return True
