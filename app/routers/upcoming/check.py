"""Check-released flow: hits TMDb for every upcoming title (rate-limited),
shows what's already out, and lets you move released ones straight into a category.
"""
from __future__ import annotations

import time
from typing import Any

from aiogram import F
from aiogram.types import Message, CallbackQuery, InlineKeyboardMarkup

from app.db.database import get_upcoming_movies, add_item, delete_upcoming_movie
from app.keyboards import (
    upcoming_menu_kb, released_check_kb, released_move_to_kb,
    UpcomingMoveCB, UpcomingCheckMoveCB, UpcomingCheckMoveToCB,
    CODE_TO_CAT,
)
from app.services.tmdb import check_upcoming_released
from app.utils import esc, safe_edit_text

from .common import router, _check_cache, _last_check_at, CHECK_COOLDOWN, _fmt_date, _days_label


async def _check_text_and_kb(chat_id: int) -> tuple[str, InlineKeyboardMarkup]:
    items = await get_upcoming_movies()
    if not items:
        return "❌ Список ожидаемых пуст.", upcoming_menu_kb()

    result = await check_upcoming_released(items)

    released: list[dict[str, Any]] = result.get("released", [])
    not_yet: list[dict[str, Any]] = result.get("not_yet", [])
    no_info: list[str] = result.get("no_info", [])

    _check_cache[chat_id] = released

    lines: list[str] = []
    if released:
        lines.append("✅ <b>Доступны в цифре:</b>")
        for e in released:
            tmdb = str(e["tmdb_title"])
            orig = str(e["title"])
            label = f"«{esc(orig)}»" if tmdb.lower() != orig.lower() else ""
            date_fmt = _fmt_date(str(e["release_date"]))
            days_lbl = _days_label(int(e["days_ago"]))
            marker = " <i>(оценочно, точной даты нет)</i>" if e.get("estimated") else ""
            lines.append(f"🎬 {esc(tmdb)} {label} — {date_fmt} ({days_lbl}){marker}")
    else:
        lines.append("✅ <b>Доступных в цифре пока нет.</b>")

    lines.append("")
    lines.append("⏳ <b>Ещё не вышли / вышли недавно:</b>")

    for e in not_yet:
        tmdb = str(e["tmdb_title"])
        orig = str(e["title"])
        label = f"(«{esc(orig)}»)" if tmdb.lower() != orig.lower() else ""
        date_fmt = _fmt_date(str(e["release_date"]))
        days = int(e["days_ago"])
        kind = "цифровой релиз" if not e.get("estimated") else "кинопремьера"
        if days <= 0:
            days_lbl = f"{kind} {date_fmt} (через {-days} дн.)"
        else:
            days_lbl = f"{kind} {date_fmt} ({days} дн. назад)"
        lines.append(f"🕐 {esc(tmdb)} {label} — {days_lbl}")

    for t in no_info:
        lines.append(f"❓ {esc(t)} — нет данных")

    text = "\n".join(lines)
    kb = released_check_kb(released) if released else upcoming_menu_kb()
    return text, kb


@router.callback_query(UpcomingMoveCB.filter(F.action == "check"))
async def up_check(call: CallbackQuery) -> None:
    if not isinstance(call.message, Message):
        return
    user_id = call.from_user.id
    now = time.monotonic()
    elapsed = now - _last_check_at.get(user_id, 0.0)
    if elapsed < CHECK_COOLDOWN:
        wait = int(CHECK_COOLDOWN - elapsed)
        await call.answer(f"⏱ Подождите {wait} сек. перед повторной проверкой.", show_alert=True)
        return
    _last_check_at[user_id] = now

    await call.answer()
    await safe_edit_text(call.message, "⏳ Проверяем по базе TMDb...", reply_markup=None)
    chat_id = call.message.chat.id
    text, kb = await _check_text_and_kb(chat_id)
    await safe_edit_text(call.message, text, reply_markup=kb)


@router.callback_query(UpcomingCheckMoveCB.filter())
async def up_check_pick(call: CallbackQuery, callback_data: UpcomingCheckMoveCB) -> None:
    if not isinstance(call.message, Message):
        return
    await call.answer()
    cache = _check_cache.get(call.message.chat.id, [])
    idx = callback_data.title_idx
    if not cache or not (0 <= idx < len(cache)):
        await call.answer("Список устарел, нажмите 'Проверить' снова.", show_alert=True)
        return
    entry = cache[idx]
    title = str(entry["title"])
    await safe_edit_text(call.message,
        f"📤 Куда перенести вышедший фильм <b>{esc(title)}</b>?",
        reply_markup=released_move_to_kb(idx)
    )


@router.callback_query(UpcomingCheckMoveToCB.filter())
async def up_check_move_to(call: CallbackQuery, callback_data: UpcomingCheckMoveToCB) -> None:
    if not isinstance(call.message, Message):
        return
    await call.answer()
    cache = _check_cache.get(call.message.chat.id, [])
    idx = callback_data.title_idx
    if not cache or not (0 <= idx < len(cache)):
        await call.answer("Список устарел, обновите.", show_alert=True)
        return

    entry = cache[idx]
    title = str(entry["title"])
    target_cat = CODE_TO_CAT[callback_data.code]

    await add_item(target_cat, title)
    await delete_upcoming_movie(title)

    _check_cache[call.message.chat.id] = [e for i, e in enumerate(cache) if i != idx]
    new_cache = _check_cache[call.message.chat.id]

    if new_cache:
        text, kb = await _check_text_and_kb(call.message.chat.id)
        await safe_edit_text(call.message, f"✅ Фильм перенесён!\n\n{text}", reply_markup=kb)
    else:
        await safe_edit_text(call.message, "✅ Все вышедшие фильмы успешно перенесены!", reply_markup=upcoming_menu_kb())
