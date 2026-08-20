"""Thin convenience wrappers over the generic item CRUD, scoped to the
upcoming_movies table."""
from __future__ import annotations

from .items import add_item, delete_item, get_items


async def get_upcoming_movies() -> list[str]:
    return await get_items("upcoming_movies")


async def add_upcoming_movie(title: str) -> None:
    await add_item("upcoming_movies", title)


async def delete_upcoming_movie(title: str) -> None:
    await delete_item("upcoming_movies", title)
