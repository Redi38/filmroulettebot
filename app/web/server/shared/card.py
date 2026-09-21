"""Card payload assembly: the JSON a spin/home/featured endpoint sends to the
front end for one title."""
from __future__ import annotations

from app.db.database import get_item_is_series
from app.services.card_data import resolve_card_data

from .posters import FRANCHISE_CATEGORIES


async def card_data(cat: str, title: str, history_timestamp: float | None = None) -> dict:
    """Assembles the JSON card payload sent to the front end for a title.

    Calls the module-level `resolve_card_data` name (rather than importing it
    inside a helper) so tests can monkeypatch
    `app.web.server.shared.card.resolve_card_data` directly.

    dc/marvel rows carry a movie-vs-series flag (whichever the user picked in
    the add/rename search); pass it through so a title that exists as both a
    film and a show resolves to the one the row actually means, instead of
    always guessing the film. Only those two categories can be ambiguous —
    everywhere else the category already settles it — so this is the only case
    worth an extra DB read.
    """
    is_series = await get_item_is_series(cat, title) if cat in FRANCHISE_CATEGORIES else None
    data = await resolve_card_data(cat, title, is_series)
    info = data["info"]

    rating = info.get("rating", "—")
    if isinstance(rating, (int, float)):
        rating = round(rating, 1)

    return {
        "category": cat,
        "title": data["title"],
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
        "watch_link": data["watch_link"],
        "history_timestamp": history_timestamp,
    }
