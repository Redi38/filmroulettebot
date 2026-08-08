"""Roll triggers: /start, category menu, "🔄 Начать"/"🎰 Крутить", reroll."""
from __future__ import annotations

import asyncio
import random

from aiogram import F
from aiogram.filters import CommandStart
from aiogram.fsm.context import FSMContext
from aiogram.types import Message, CallbackQuery
from aiogram.exceptions import TelegramBadRequest

from app.db.database import get_items, save_history
from app.keyboards import main_kb, spin_kb, after_roll_kb, SpinCB, RerollCB, CODE_TO_CAT, CAT_RU

from .common import router, logger, _roll_on_cooldown, _full_title_cache, _build_card


@router.message(CommandStart())
async def cmd_start(msg: Message, state: FSMContext) -> None:
    await state.clear()
    await msg.answer("🎉 Добро пожаловать в кино-рулетку! Выберите действие:", reply_markup=main_kb())


ROULETTE_MAP = {
    "🎬 Рулетка Фильм": "movies",
    "🎥 Рулетка Мульт": "cartoons",
    "📺 Рулетка Сериал": "series",
}


@router.message(F.text.in_(ROULETTE_MAP))
async def open_spin_menu(msg: Message) -> None:
    if not msg.text:
        return
    cat = ROULETTE_MAP[msg.text]
    ru = CAT_RU.get(cat, cat)
    await msg.answer(f"🎲 Категория: <b>{ru}</b>", reply_markup=spin_kb(cat))


@router.message(F.text == "🔄 Начать")
async def random_start(msg: Message) -> None:
    user_id = msg.from_user.id if msg.from_user else msg.chat.id
    wait = _roll_on_cooldown(user_id)
    if wait > 0:
        await msg.answer(f"⏳ Подожди {wait:.1f} сек. перед следующим роллом.")
        return

    all_cats = ["movies", "cartoons", "series"]

    non_empty = [c for c in all_cats if await get_items(c)]
    if not non_empty:
        await msg.answer("❌ Все три рулетки пустые.", reply_markup=main_kb())
        return

    cat = random.choice(non_empty)
    await _spin(msg, cat)


@router.callback_query(SpinCB.filter())
async def spin_cb(call: CallbackQuery, callback_data: SpinCB) -> None:
    if not isinstance(call.message, Message):
        return
    user_id = call.from_user.id
    wait = _roll_on_cooldown(user_id)
    if wait > 0:
        await call.answer(f"⏳ Подожди {wait:.1f} сек.", show_alert=False)
        return
    await call.answer()
    cat = CODE_TO_CAT[callback_data.code]
    await call.message.edit_text("🌀 Крутим рулетку…", reply_markup=None)
    await asyncio.sleep(0.6)
    await _spin_edit(call.message, cat)


@router.callback_query(RerollCB.filter())
async def reroll_cb(call: CallbackQuery, callback_data: RerollCB) -> None:
    if not isinstance(call.message, Message):
        return
    user_id = call.from_user.id
    wait = _roll_on_cooldown(user_id)
    if wait > 0:
        await call.answer(f"⏳ Подожди {wait:.1f} сек.", show_alert=False)
        return
    await call.answer()
    cat = CODE_TO_CAT[callback_data.code]
    _full_title_cache.pop((call.message.chat.id, call.message.message_id), None)

    try:
        await call.message.delete()
    except TelegramBadRequest as e:
        logger.warning("reroll_cb: failed to delete message %s: %s", call.message.message_id, e)

    temp_msg = await call.message.answer("🌀 Перекручиваем…")
    await asyncio.sleep(0.6)
    await _spin_edit(temp_msg, cat)


async def _spin(msg: Message, category: str) -> None:
    items = await get_items(category)
    if not items:
        await msg.answer("❌ Список пуст.")
        return
    choice = random.choice(items)
    user_id = msg.from_user.id if msg.from_user else msg.chat.id
    await save_history(user_id, category, choice)

    temp_msg = await msg.answer("🌀 Крутим рулетку…")
    await asyncio.sleep(0.6)
    await _spin_edit(temp_msg, category, choice)


async def _spin_edit(msg: Message, category: str, choice: str | None = None) -> None:
    if choice is None:
        items = await get_items(category)
        if not items:
            await msg.edit_text("❌ Список пуст.", reply_markup=spin_kb(category))
            return
        choice = random.choice(items)
        user_id = msg.from_user.id if msg.from_user else msg.chat.id
        await save_history(user_id, category, choice)

    caption, caption_short, poster = await _build_card(category, choice)
    kb = after_roll_kb(category, choice)
    chat_id = msg.chat.id
    try:
        if poster:
            await msg.delete()
            final_msg = await msg.answer_photo(poster, caption=caption_short, reply_markup=kb)
        else:
            final_msg = await msg.edit_text(caption[:4096], reply_markup=kb)
    except TelegramBadRequest as e:
        logger.warning("_spin_edit: failed to update card for %r: %s", choice, e)
        final_msg = await msg.edit_text(caption[:4096], reply_markup=kb)

    if isinstance(final_msg, Message):
        _full_title_cache[(chat_id, final_msg.message_id)] = choice
