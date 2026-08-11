"""List preview/edit menu, add-item flow, and "Назад" navigation.
(Delete flow lives in delete.py — split out to keep this file focused.)
"""
from __future__ import annotations

from aiogram import F
from aiogram.fsm.context import FSMContext
from aiogram.types import Message, CallbackQuery
from aiogram.exceptions import TelegramBadRequest

from app.db.database import get_items, add_item, item_exists
from app.states import AddItemStates
from app.keyboards import (
    main_kb, spin_kb, edit_menu_kb, cancel_add_kb, DELETE_PAGE_SIZE,
    EditMenuCB, AddItemCB, CancelAddCB, BackMainCB, PageCB,
    pagination_row, CODE_TO_CAT, CAT_RU,
)
from app.utils import esc, safe_edit_text, safe_edit_caption, render_paginated_list

from .common import router, logger


async def _render_edit_menu(cat: str, page: int) -> tuple[str, int]:
    ru = CAT_RU.get(cat, cat)
    items = await get_items(cat)
    body, page, total_pages = render_paginated_list(items, page, page_size=DELETE_PAGE_SIZE)
    text = f"✏️ <b>{ru}</b> — управление списком:\n\n{body}"
    return text, total_pages


@router.callback_query(EditMenuCB.filter())
async def edit_menu_cb(call: CallbackQuery, callback_data: EditMenuCB) -> None:
    if not isinstance(call.message, Message):
        return
    await call.answer()
    cat = CODE_TO_CAT[callback_data.code]
    text, total_pages = await _render_edit_menu(cat, 1)
    row = pagination_row(f"editlist_{callback_data.code}", 1, total_pages)
    await safe_edit_text(call.message, text, reply_markup=edit_menu_kb(cat, row))


@router.callback_query(PageCB.filter(F.scope.startswith("editlist_")))
async def edit_menu_page(call: CallbackQuery, callback_data: PageCB) -> None:
    if not isinstance(call.message, Message):
        return
    await call.answer()
    code = callback_data.scope.removeprefix("editlist_")
    cat = CODE_TO_CAT.get(code)
    if cat is None:
        return
    text, total_pages = await _render_edit_menu(cat, callback_data.page)
    row = pagination_row(f"editlist_{code}", callback_data.page, total_pages)
    await safe_edit_text(call.message, text, reply_markup=edit_menu_kb(cat, row))


@router.callback_query(AddItemCB.filter())
async def add_item_start(call: CallbackQuery, callback_data: AddItemCB, state: FSMContext) -> None:
    if not isinstance(call.message, Message):
        return
    await call.answer()
    cat = CODE_TO_CAT[callback_data.code]
    ru = CAT_RU.get(cat, cat)
    await state.set_state(AddItemStates.waiting_title)
    await state.update_data(category=cat)
    await safe_edit_text(
        call.message,
        f"✏️ Введите название для добавления в <b>{ru}</b>:",
        reply_markup=cancel_add_kb(callback_data.code),
    )
    await state.update_data(prompt_msg_id=call.message.message_id, prompt_chat_id=call.message.chat.id)


@router.callback_query(CancelAddCB.filter(F.code != ""))
async def cancel_add(call: CallbackQuery, callback_data: CancelAddCB, state: FSMContext) -> None:
    if not isinstance(call.message, Message):
        return
    await call.answer()
    await state.clear()
    cat = CODE_TO_CAT.get(callback_data.code)
    if cat is None:
        return
    text, total_pages = await _render_edit_menu(cat, 1)
    row = pagination_row(f"editlist_{callback_data.code}", 1, total_pages)
    await safe_edit_text(call.message, text, reply_markup=edit_menu_kb(cat, row))


@router.callback_query(BackMainCB.filter(F.target.in_({"main", "sp__m", "sp__c", "sp__s", "sp__dc", "sp__mv"})))
async def back_main(call: CallbackQuery, callback_data: BackMainCB) -> None:
    if not isinstance(call.message, Message):
        return
    await call.answer()
    target = callback_data.target
    if target == "main":
        try:
            await call.message.delete()
        except TelegramBadRequest as e:
            logger.warning("back_main: failed to delete message: %s", e)
            if call.message.photo or call.message.document or call.message.video or call.message.animation:
                await safe_edit_caption(call.message, caption="Возврат в меню...", reply_markup=None)
            else:
                await safe_edit_text(call.message, "Возврат в меню...", reply_markup=None)
        await call.message.answer("🎉 Выберите действие:", reply_markup=main_kb())
    elif target.startswith("sp__"):
        code = target[4:]
        cat = CODE_TO_CAT.get(code, "movies")
        ru = CAT_RU.get(cat, cat)
        if call.message.photo or call.message.document or call.message.video or call.message.animation:
            try:
                await call.message.delete()
                await call.message.answer(f"🎲 Категория: <b>{ru}</b>", reply_markup=spin_kb(cat))
            except TelegramBadRequest as e:
                logger.warning("back_main: failed to delete photo message: %s", e)
                await safe_edit_caption(call.message, caption=f"🎲 Категория: <b>{ru}</b>", reply_markup=spin_kb(cat))
        else:
            await safe_edit_text(call.message, f"🎲 Категория: <b>{ru}</b>", reply_markup=spin_kb(cat))


@router.message(AddItemStates.waiting_title, F.text & ~F.text.startswith("/"))
async def handle_pending_add(msg: Message, state: FSMContext) -> None:
    data = await state.get_data()
    cat = data.get("category")
    prompt_msg_id = data.get("prompt_msg_id")
    prompt_chat_id = data.get("prompt_chat_id")
    await state.clear()
    if not cat:
        return

    if prompt_msg_id and prompt_chat_id:
        try:
            await msg.bot.delete_message(prompt_chat_id, prompt_msg_id)
        except TelegramBadRequest as e:
            logger.warning("handle_pending_add: failed to delete prompt message: %s", e)

    title = (msg.text or "").strip()
    if not title:
        await msg.answer("❌ Название не может быть пустым.")
        return

    if await item_exists(cat, title):
        ru = CAT_RU.get(cat, cat)
        kb = edit_menu_kb(cat) if cat in ("dc", "marvel") else spin_kb(cat)
        await msg.answer(f"⚠ «{esc(title)}» уже есть в списке «{ru}».", reply_markup=kb)
        return

    await add_item(cat, title)
    ru = CAT_RU.get(cat, cat)
    kb = edit_menu_kb(cat) if cat in ("dc", "marvel") else spin_kb(cat)
    await msg.answer(f"✅ <b>{esc(title)}</b> добавлен в «{ru}».", reply_markup=kb)
