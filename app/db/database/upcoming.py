"""Thin convenience wrappers over the generic item CRUD, scoped to the
upcoming_movies table."""
from __future__ import annotations

from .items import (
    add_item,
    delete_item,
    delete_item_by_id,
    get_items,
    get_items_with_ids,
    item_exists_other_id,
    rename_item,
    rename_item_by_id,
)


async def get_upcoming_movies() -> list[str]:
    return await get_items("upcoming_movies")


async def get_upcoming_movies_with_ids() -> list[dict]:
    return await get_items_with_ids("upcoming_movies")


async def add_upcoming_movie(title: str) -> None:
    await add_item("upcoming_movies", title)


async def delete_upcoming_movie(title: str) -> None:
    await delete_item("upcoming_movies", title)


async def delete_upcoming_movie_by_id(item_id: int) -> None:
    await delete_item_by_id("upcoming_movies", item_id)


async def rename_upcoming_movie(old_title: str, new_title: str) -> None:
    await rename_item("upcoming_movies", old_title, new_title)


async def rename_upcoming_movie_by_id(item_id: int, new_title: str) -> bool:
    return await rename_item_by_id("upcoming_movies", item_id, new_title)


async def upcoming_title_taken_by_other(title: str, exclude_id: int) -> bool:
    return await item_exists_other_id("upcoming_movies", title, exclude_id)
