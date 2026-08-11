"""Upcoming list: /upcoming, /add_upcoming, delete flow (paginated), nav back."""
from __future__ import annotations

from aiogram import F
from aiogram.filters import Command
from aiogram.fsm.context import FSMContext
from aiogram.types import Message, CallbackQuery

from app.db.database import get_upcoming_movies, add_upcoming_movie, delete_upcoming_movie, item_exists
from app.states import UpcomingStates
from app.keyboards import (
    upcoming_menu_kb, upcoming_delete_kb, cancel_add_kb, BackMainCB, pagination_row, PageCB,
    UpcomingMoveCB, UpcomingDeleteOneCB, UpcomingAddCB, CancelAddCB,
)
from app.utils import esc, render_paginated_list, safe_edit_text

from .common import router


@router.message(Command("upcoming"))
async def upcoming_cmd(msg: Message, state: FSMContext) -> None:
    await state.clear()
    items = await get_upcoming_movies()
    text, page, total_pages = render_paginated_list(items, 1)
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
        "✏️ Введите название фильма для добавления в ожидаемые:",
        reply_markup=cancel_add_kb(),
    )


@router.callback_query(CancelAddCB.filter(F.code == ""))
async def cancel_upcoming_add(call: CallbackQuery, state: FSMContext) -> None:
    if not isinstance(call.message, Message):
        return
    await call.answer()
    await state.clear()
    items = await get_upcoming_movies()
    text, page, total_pages = render_paginated_list(items, 1)
    row = pagination_row("up", page, total_pages)
    await safe_edit_text(call.message, f"<b>🎬 Ожидаемые фильмы:</b>\n\n{text}", reply_markup=upcoming_menu_kb(row))


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


@router.callback_query(BackMainCB.filter(F.target == "up"))
async def up_back_to_menu(call: CallbackQuery) -> None:
    if not isinstance(call.message, Message):
        return
    await call.answer()
    items = await get_upcoming_movies()
    text, page, total_pages = render_paginated_list(items, 1)
    row = pagination_row("up", page, total_pages)
    await safe_edit_text(call.message, f"<b>🎬 Ожидаемые фильмы:</b>\n\n{text}", reply_markup=upcoming_menu_kb(row))


@router.callback_query(PageCB.filter(F.scope == "up"))
async def up_page(call: CallbackQuery, callback_data: PageCB) -> None:
    if not isinstance(call.message, Message):
        return
    await call.answer()
    items = await get_upcoming_movies()
    text, page, total_pages = render_paginated_list(items, callback_data.page)
    row = pagination_row("up", page, total_pages)
    await safe_edit_text(call.message, f"<b>🎬 Ожидаемые фильмы:</b>\n\n{text}", reply_markup=upcoming_menu_kb(row))


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
