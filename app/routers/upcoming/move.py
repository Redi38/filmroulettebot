"""Move-to-category flow: pick a title from the upcoming list, then a target category."""
from __future__ import annotations

from aiogram import F
from aiogram.types import CallbackQuery, Message

from app.db.database import add_item, delete_upcoming_movie, get_upcoming_movies
from app.keyboards import (
    CAT_RU,
    CODE_TO_CAT,
    BackMainCB,
    UpcomingMoveCB,
    UpcomingMoveTargetCB,
    UpcomingSelectCB,
    upcoming_list_kb,
    upcoming_menu_kb,
    upcoming_targets_kb,
)
from app.utils import esc, safe_edit_text

from .common import _up_sel_title, router


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
