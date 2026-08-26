"""Shared router instance, state, and helpers used by spin.py / confirm.py /
edit.py. Each submodule decorates handlers on the SAME `router` object
imported from here, so they all end up registered on one Router — main.py
still just does `dp.include_routers(roulette.router, ...)` unchanged.
"""
from __future__ import annotations

import logging
import re
import time

from aiogram import Router

from app.services.card_data import resolve_card_data
from app.services.titles import pick_title
from app.utils import esc

logger = logging.getLogger(__name__)
router = Router()

_full_title_cache: dict[tuple[int, int], str] = {}

_last_roll_at: dict[int, float] = {}
ROLL_COOLDOWN = 1.5  # seconds

_last_roll_title: dict[tuple[int, str], str] = {}


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


def _pick_for_user(user_id: int, category: str, items: list[str]) -> str:
    """Same no-immediate-repeat rule the web frontend uses, keyed per user
    instead of per client IP."""
    key = (user_id, category)
    title = pick_title(items, _last_roll_title.get(key))
    _last_roll_title[key] = title
    return title


def _star_bar(rating) -> str:
    """5-star visual bar scaled from a 0-10 TMDB rating, e.g. 8.9 -> ⭐️⭐️⭐️⭐️☆."""
    if not isinstance(rating, (int, float)):
        return ""
    filled = max(0, min(5, round(rating / 2)))
    return "⭐️" * filled + "☆" * (5 - filled)


async def _build_card(category: str, title: str) -> tuple[str, str, str | None]:
    data = await resolve_card_data(category, title)
    info = data["info"]
    display_title = data["title"]
    link = data["watch_link"]
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
