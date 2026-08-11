"""Shared router instance, state, and helpers used by spin.py / confirm.py /
edit.py. Each submodule decorates handlers on the SAME `router` object
imported from here, so they all end up registered on one Router — main.py
still just does `dp.include_routers(roulette.router, ...)` unchanged.
"""
from __future__ import annotations

import asyncio
import logging
import re
import time

from aiogram import Router

from app.services.tmdb import get_movie_info, get_series_info
from app.services.watch_link import find_watch_page_url
from app.utils import esc, build_watch_link

logger = logging.getLogger(__name__)
router = Router()

_full_title_cache: dict[tuple[int, int], str] = {}

TMDB_TIMEOUT = 6  # seconds

_last_roll_at: dict[int, float] = {}
ROLL_COOLDOWN = 1.5  # seconds


def _roll_on_cooldown(user_id: int) -> float:
    """Returns remaining cooldown seconds (0 if not on cooldown). Updates the
    timestamp as a side effect only when NOT on cooldown, so a burst of taps
    during the cooldown window doesn't keep pushing the window forward."""
    now = time.monotonic()
    elapsed = now - _last_roll_at.get(user_id, 0.0)
    if elapsed < ROLL_COOLDOWN:
        return ROLL_COOLDOWN - elapsed
    _last_roll_at[user_id] = now
    return 0.0


def _resolve_title(chat_id: int, message_id: int, short_title: str) -> str:
    """Return the full title for this specific card, falling back
    to the (possibly truncated) title from callback_data if cache is empty/stale."""
    cached = _full_title_cache.get((chat_id, message_id))
    return cached if cached else short_title


async def _fetch_tmdb_info(category: str, title: str) -> dict:
    try:
        if category == "series":
            return await asyncio.wait_for(get_series_info(title), timeout=TMDB_TIMEOUT) or {}
        return await asyncio.wait_for(get_movie_info(title), timeout=TMDB_TIMEOUT) or {}
    except asyncio.TimeoutError:
        logger.warning("_build_card: TMDB timeout for %r (%s)", title, category)
        return {}


def _star_bar(rating) -> str:
    """5-star visual bar scaled from a 0-10 TMDB rating, e.g. 8.9 -> ⭐️⭐️⭐️⭐️☆."""
    if not isinstance(rating, (int, float)):
        return ""
    filled = max(0, min(5, round(rating / 2)))
    return "⭐️" * filled + "☆" * (5 - filled)


async def _build_card(category: str, title: str) -> tuple[str, str, str | None]:
    tmdb_task = asyncio.create_task(_fetch_tmdb_info(category, title))
    kinogo_task = asyncio.create_task(find_watch_page_url(title))
    info, direct_link = await asyncio.gather(tmdb_task, kinogo_task)

    display_title = info.get("title", title)
    if direct_link:
        link = direct_link
    elif display_title != title:
        # Не нашли по исходному title — пробуем ещё раз уже по TMDB-названию.
        link = await find_watch_page_url(display_title) or build_watch_link(display_title)
    else:
        link = build_watch_link(display_title)
    link_block = f'\n\n▶️ <a href="{esc(link)}">Смотреть онлайн</a>' if link else ""

    rating = info.get("rating", "—")
    stars = _star_bar(rating)
    rating_line = f"⭐️ Рейтинг: {stars} {rating}/10\n" if stars else f"⭐️ Рейтинг: {esc(str(rating))}\n"

    def _render(desc_limit: int) -> str:
        desc = _trim(info.get("overview", ""), desc_limit)
        if category == "series":
            return (
                f"📺 <b><code>{esc(display_title)}</code></b>\n\n"
                f"{rating_line}"
                f"🗓 Дата выхода: {esc(str(info.get('release_date', '—')))}\n"
                f"🎭 Жанры: {esc(info.get('genres', '—'))}\n"
                f"👥 Актёры: {esc(info.get('actors', '—'))}\n\n"
                f"📚 Сезонов: {esc(str(info.get('seasons', '—')))} "
                f"🎥 Эпизодов: {esc(str(info.get('episodes', '—')))}\n\n"
                f"───────────\n"
                f"📖 {esc(desc)}{link_block}"
            )
        emoji = "🎬" if category == "movies" else "🎥"
        return (
            f"{emoji} <b><code>{esc(display_title)}</code></b>\n\n"
            f"{rating_line}"
            f"🗓 Дата выхода: {esc(str(info.get('release_date', '—')))}\n"
            f"⏳ Длительность: {esc(str(info.get('runtime', '—')))} мин.\n"
            f"🎭 Жанры: {esc(info.get('genres', '—'))}\n"
            f"👥 Актёры: {esc(info.get('actors', '—'))}\n\n"
            f"───────────\n"
            f"📖 {esc(desc)}{link_block}"
        )

    # Полная версия (для текстовых сообщений, лимит 4096) — с длинным описанием.
    caption = _render(desc_limit=900)
    # Короткая версия под лимит подписи к фото (1024 символа) — короче описание,
    # чтобы точно уложиться целиком и не резать <a>/<code> теги посередине.
    caption_short = _render(desc_limit=250)
    if len(caption_short) > 1024:
        caption_short = _render(desc_limit=80)
    return caption, caption_short, info.get("poster_url")


def _trim(text: str, limit: int = 900) -> str:
    text = re.sub(r"<[^>]+>", "", text or "")
    return text[:limit] + "…" if len(text) > limit else text
