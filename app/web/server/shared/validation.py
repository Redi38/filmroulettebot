"""Small validation helpers shared by the item/list route modules."""
from __future__ import annotations

from fastapi import HTTPException

from .constants import CATEGORIES


def check_category(cat: str) -> None:
    if cat not in CATEGORIES:
        raise HTTPException(404, f"Unknown category: {cat}")


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
