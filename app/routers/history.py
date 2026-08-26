"""History commands."""
from __future__ import annotations

from datetime import datetime

from aiogram import Router
from aiogram.filters import Command
from aiogram.types import Message

from app.db.database import load_history, clear_user_history
from app.services.categories import CATEGORY_LABELS
from app.utils import esc

router = Router()


@router.message(Command("history"))
async def history_cmd(msg: Message) -> None:
    hist = await load_history(msg.from_user.id)  # type: ignore[union-attr]
    if not hist:
        await msg.answer("📜 История пуста.")
        return

    films_list = []
    series_list = []

    for h in hist:
        cat_code = h["category"]
        title = h["title"]
        dt = datetime.fromtimestamp(h["timestamp"]).strftime("%d.%m.%Y %H:%M")
        cat_ru = CATEGORY_LABELS.get(cat_code, cat_code)

        line = f"{esc(title)} [{cat_ru}] — {dt}"

        if cat_code == "series":
            series_list.append(line)
        else:
            films_list.append(line)

    parts = []
    if films_list:
        lines = "\n".join(f"{i+1}. {line}" for i, line in enumerate(films_list))
        parts.append(f"🎬 Фильмы и мультфильмы:\n{lines}")

    if series_list:
        lines = "\n".join(f"{i+1}. {line}" for i, line in enumerate(series_list))
        parts.append(f"📺 Сериалы:\n{lines}")

    text = "\n\n".join(parts)
    await msg.answer(text)


@router.message(Command("clear_history"))
async def clear_history_cmd(msg: Message) -> None:
    await clear_user_history(msg.from_user.id)  # type: ignore[union-attr]
    await msg.answer("🧹 Ваша история очищена.")
