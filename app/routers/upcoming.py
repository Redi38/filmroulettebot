"""Upcoming movies management."""
from __future__ import annotations

import logging
import time
from datetime import datetime
from typing import Any

from aiogram import Router, F
from aiogram.filters import Command
from aiogram.fsm.context import FSMContext
from aiogram.types import Message, CallbackQuery, InlineKeyboardMarkup

from app.db.database import (
    get_upcoming_movies, add_upcoming_movie, delete_upcoming_movie,
    add_item, item_exists,
)
from app.states import UpcomingStates
from app.keyboards import (
    upcoming_menu_kb, upcoming_list_kb, upcoming_targets_kb,
    upcoming_delete_kb, BackMainCB, pagination_row, PageCB,
    UpcomingMoveCB, UpcomingSelectCB, UpcomingDeleteOneCB, UpcomingMoveTargetCB,
    UpcomingCheckMoveCB, UpcomingCheckMoveToCB, UpcomingAddCB,
    released_check_kb, released_move_to_kb,
    CODE_TO_CAT, CAT_RU,
)
from app.services.tmdb import check_upcoming_released
from app.utils import esc, render_numbered_list, paginate, safe_edit_text

logger = logging.getLogger(__name__)
router = Router()

# Промежуточный выбор между callback'ами (не текстовый ввод) — не критично держать вне FSM.
_up_sel_title: dict[int, str] = {}
_check_cache: dict[int, list[dict[str, Any]]] = {}

# Rate-limit на "Проверить вышедшие" — каждый тайтл в списке дёргает TMDb,
# поэтому не даём вызывать проверку чаще, чем раз в CHECK_COOLDOWN секунд на юзера.
_last_check_at: dict[int, float] = {}
CHECK_COOLDOWN = 60  # seconds


def _fmt_date(date_str: str) -> str:
    try:
        return datetime.strptime(date_str, "%Y-%m-%d").strftime("%d.%m.%Y")
    except ValueError:
        return date_str


def _days_label(days_ago: int) -> str:
    if days_ago > 0:
        return f"{days_ago} дн. назад"
    elif days_ago == 0:
        return "сегодня"
    else:
        return f"через {-days_ago} дн."


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
        lines.append("✅ <b>Уже вышли (&gt;45 дней назад):</b>")
        for e in released:
            tmdb = str(e["tmdb_title"])
            orig = str(e["title"])
            label = f"«{esc(orig)}»" if tmdb.lower() != orig.lower() else ""
            date_fmt = _fmt_date(str(e["release_date"]))
            days_lbl = _days_label(int(e["days_ago"]))
            lines.append(f"🎬 {esc(tmdb)} {label} — {date_fmt} ({days_lbl})")
    else:
        lines.append("✅ <b>Уже вышедших (&gt;45 дней назад) нет.</b>")

    lines.append("")
    lines.append("⏳ <b>Ещё не вышли / вышли недавно:</b>")

    for e in not_yet:
        tmdb = str(e["tmdb_title"])
        orig = str(e["title"])
        label = f"(«{esc(orig)}»)" if tmdb.lower() != orig.lower() else ""
        date_fmt = _fmt_date(str(e["release_date"]))
        days = int(e["days_ago"])
        if days <= 0:
            days_lbl = f"премьера {date_fmt} (через {-days} дн.)"
        else:
            days_lbl = f"вышел {date_fmt} ({days} дн. назад)"
        lines.append(f"🕐 {esc(tmdb)} {label} — {days_lbl}")

    for t in no_info:
        lines.append(f"❓ {esc(t)} — нет данных")

    text = "\n".join(lines)
    kb = released_check_kb(released) if released else upcoming_menu_kb()
    return text, kb


@router.message(Command("upcoming"))
async def upcoming_cmd(msg: Message, state: FSMContext) -> None:
    await state.clear()
    items = await get_upcoming_movies()
    _, page, total_pages = paginate(items, 1)
    text = render_numbered_list(items, page)
    row = pagination_row("up", page, total_pages)
    await msg.answer(f"<b>🎬 Ожидаемые фильмы:</b>\n\n{text}", reply_markup=upcoming_menu_kb(row))


@router.message(Command("add_upcoming"))
async def add_upcoming_cmd(msg: Message) -> None:
    parts = (msg.text or "").split(maxsplit=1)
    if len(parts) < 2 or not parts[1].strip():
        await msg.answer("⚠ Использование: /add_upcoming Название фильма")
        return
    title = parts[1].strip()

    if await item_exists("upcoming_movies", title):
        await msg.answer(f"⚠ «{esc(title)}» уже в списке ожидаемых.")
        return

    await add_upcoming_movie(title)
    await msg.answer(f"✅ <b>{esc(title)}</b> добавлен в ожидаемые.")


@router.callback_query(UpcomingMoveCB.filter(F.action == "move"))
async def up_move(call: CallbackQuery) -> None:
    if not isinstance(call.message, Message):
        return
    await call.answer()
    items = await get_upcoming_movies()
    if not items:
        await call.answer("❌ Нет ожидаемых фильмов.", show_alert=True)
    else:
        await safe_edit_text(call.message, "📤 Выберите фильм для переноса:", reply_markup=upcoming_list_kb(items))


@router.callback_query(UpcomingMoveCB.filter(F.action == "del"))
async def up_delete_menu(call: CallbackQuery) -> None:
    if not isinstance(call.message, Message):
        return
    await call.answer()
    items = await get_upcoming_movies()
    if not items:
        await call.answer("❌ Нет ожидаемых фильмов.", show_alert=True)
        return
    await safe_edit_text(call.message, "🗑 Удалить из ожидаемых:", reply_markup=upcoming_delete_kb(items))


@router.callback_query(UpcomingAddCB.filter())
async def up_add_start(call: CallbackQuery, state: FSMContext) -> None:
    if not isinstance(call.message, Message):
        return
    await call.answer()
    await state.set_state(UpcomingStates.waiting_title)
    await safe_edit_text(call.message, 
        "✏️ Введите название фильма для добавления в ожидаемые:\n\n<i>Для отмены — /upcoming</i>",
        reply_markup=None,
    )


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


@router.callback_query(UpcomingDeleteOneCB.filter())
async def up_delete_one(call: CallbackQuery, callback_data: UpcomingDeleteOneCB) -> None:
    if not isinstance(call.message, Message):
        return
    await call.answer()
    items = await get_upcoming_movies()
    if not items or not (0 <= callback_data.idx < len(items)):
        await call.answer("Ошибка выбора.", show_alert=True)
        return
    title = items[callback_data.idx]
    await delete_upcoming_movie(title)

    items = await get_upcoming_movies()
    if items:
        await safe_edit_text(call.message, 
            f"🗑 <b>{esc(title)}</b> удалён.\n\nУдалить ещё:",
            reply_markup=upcoming_delete_kb(items, page=callback_data.page)
        )
    else:
        await safe_edit_text(call.message, "Список ожидаемых пуст.", reply_markup=upcoming_menu_kb())


@router.callback_query(PageCB.filter(F.scope == "updel"))
async def up_delete_page(call: CallbackQuery, callback_data: PageCB) -> None:
    if not isinstance(call.message, Message):
        return
    await call.answer()
    items = await get_upcoming_movies()
    if not items:
        await safe_edit_text(call.message, "Список ожидаемых пуст.", reply_markup=upcoming_menu_kb())
        return
    await safe_edit_text(
        call.message,
        "🗑 Удалить из ожидаемых:",
        reply_markup=upcoming_delete_kb(items, page=callback_data.page),
    )


@router.callback_query(UpcomingSelectCB.filter())
async def up_select_title(call: CallbackQuery, callback_data: UpcomingSelectCB) -> None:
    if not isinstance(call.message, Message):
        return
    await call.answer()
    items = await get_upcoming_movies()
    if not items or not (0 <= callback_data.idx < len(items)):
        await call.answer("Ошибка выбора.", show_alert=True)
        return
    title = items[callback_data.idx]
    _up_sel_title[call.message.chat.id] = title
    await safe_edit_text(call.message, f"📤 Куда перенести <b>{esc(title)}</b>?", reply_markup=upcoming_targets_kb())


@router.callback_query(UpcomingMoveTargetCB.filter())
async def up_move_to(call: CallbackQuery, callback_data: UpcomingMoveTargetCB) -> None:
    if not isinstance(call.message, Message):
        return
    await call.answer()
    target_cat = CODE_TO_CAT[callback_data.code]
    ru = CAT_RU.get(target_cat, target_cat)
    title = _up_sel_title.pop(call.message.chat.id, None)
    if not title:
        await call.answer("Не выбран фильм.", show_alert=True)
        return
    await add_item(target_cat, title)
    await delete_upcoming_movie(title)
    await safe_edit_text(call.message, f"✅ <b>{esc(title)}</b> перенесён в {ru}.", reply_markup=upcoming_menu_kb())


# ─── Check-release move callbacks ─────────────────────────────────────────────
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


# ─── Navigation ────────────────────────────────────────────────────────────────
@router.callback_query(BackMainCB.filter(F.target == "up"))
async def up_back_to_menu(call: CallbackQuery) -> None:
    if not isinstance(call.message, Message):
        return
    await call.answer()
    items = await get_upcoming_movies()
    _, page, total_pages = paginate(items, 1)
    text = render_numbered_list(items, page)
    row = pagination_row("up", page, total_pages)
    await safe_edit_text(call.message, f"<b>🎬 Ожидаемые фильмы:</b>\n\n{text}", reply_markup=upcoming_menu_kb(row))


@router.callback_query(PageCB.filter(F.scope == "up"))
async def up_page(call: CallbackQuery, callback_data: PageCB) -> None:
    if not isinstance(call.message, Message):
        return
    await call.answer()
    items = await get_upcoming_movies()
    _, page, total_pages = paginate(items, callback_data.page)
    text = render_numbered_list(items, page)
    row = pagination_row("up", page, total_pages)
    await safe_edit_text(call.message, f"<b>🎬 Ожидаемые фильмы:</b>\n\n{text}", reply_markup=upcoming_menu_kb(row))


@router.callback_query(BackMainCB.filter(F.target == "upsel"))
async def up_back_to_titles(call: CallbackQuery) -> None:
    if not isinstance(call.message, Message):
        return
    await call.answer()
    items = await get_upcoming_movies()
    if items:
        await safe_edit_text(call.message, "📤 Выберите фильм для переноса:", reply_markup=upcoming_list_kb(items))
    else:
        await safe_edit_text(call.message, "❌ Нет ожидаемых фильмов.", reply_markup=upcoming_menu_kb())


# ─── Text input handler (waiting for a title) ─────────────────────────────────
@router.message(UpcomingStates.waiting_title, F.text & ~F.text.startswith("/"))
async def handle_pending_upcoming_add(msg: Message, state: FSMContext) -> None:
    await state.clear()
    title = (msg.text or "").strip()
    if not title:
        await msg.answer("❌ Название не может быть пустым.")
        return

    if await item_exists("upcoming_movies", title):
        await msg.answer(f"⚠ «{esc(title)}» уже в списке ожидаемых.", reply_markup=upcoming_menu_kb())
        return

    await add_upcoming_movie(title)
    items = await get_upcoming_movies()
    text = "\n".join(f"{i + 1}. {esc(t)}" for i, t in enumerate(items))
    await msg.answer(
        f"✅ <b>{esc(title)}</b> добавлен в ожидаемые.\n\n🎬 Ожидаемые фильмы:\n{text}",
        reply_markup=upcoming_menu_kb(),
    )
