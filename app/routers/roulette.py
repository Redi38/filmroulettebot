"""Movie/series roulette: spinning, editing lists, confirming picks."""
from __future__ import annotations

import asyncio
import logging
import random
import re

from aiogram import Router, F
from aiogram.filters import CommandStart
from aiogram.fsm.context import FSMContext
from aiogram.types import Message, CallbackQuery
from aiogram.exceptions import TelegramBadRequest

from app.db.database import get_items, add_item, delete_item, save_history, item_exists
from app.states import AddItemStates
from app.keyboards import (
    main_kb, spin_kb, after_roll_kb, edit_menu_kb, delete_list_kb, sequel_kb,
    SpinCB, RerollCB, ConfirmCB, EditMenuCB, AddItemCB, DeleteMenuCB, DeleteItemCB,
    SequelYesCB, SequelNoCB, BackMainCB, CODE_TO_CAT, CAT_RU,
)
from app.services.tmdb import get_movie_info, get_series_info
from app.utils import esc

logger = logging.getLogger(__name__)
router = Router()

_last_category: dict[int, str] = {}

_full_title_cache: dict[int, str] = {}

TMDB_TIMEOUT = 6  # seconds


def _resolve_title(chat_id: int, short_title: str) -> str:
    """Return the full title for the last spun card in this chat, falling back
    to the (possibly truncated) title from callback_data if cache is empty/stale."""
    cached = _full_title_cache.get(chat_id)
    return cached if cached else short_title


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
    await call.answer()
    cat = CODE_TO_CAT[callback_data.code]
    await call.message.edit_text("🌀 Крутим рулетку…", reply_markup=None)
    await asyncio.sleep(0.6)
    await _spin_edit(call.message, cat)


@router.callback_query(RerollCB.filter())
async def reroll_cb(call: CallbackQuery, callback_data: RerollCB) -> None:
    if not isinstance(call.message, Message):
        return
    await call.answer()
    cat = CODE_TO_CAT[callback_data.code]

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
    chat_id = msg.chat.id
    _full_title_cache[chat_id] = choice
    user_id = msg.from_user.id if msg.from_user else chat_id
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
        chat_id = msg.chat.id
        _full_title_cache[chat_id] = choice
        user_id = msg.from_user.id if msg.from_user else chat_id
        await save_history(user_id, category, choice)

    caption, poster = await _build_card(category, choice)
    kb = after_roll_kb(category, choice)
    try:
        if poster:
            await msg.delete()
            await msg.answer_photo(poster, caption=caption, reply_markup=kb)
        else:
            await msg.edit_text(caption[:4096], reply_markup=kb)
    except TelegramBadRequest as e:
        logger.warning("_spin_edit: failed to update card for %r: %s", choice, e)
        await msg.edit_text(caption[:4096], reply_markup=kb)


async def _build_card(category: str, title: str) -> tuple[str, str | None]:
    try:
        if category == "series":
            info = await asyncio.wait_for(get_series_info(title), timeout=TMDB_TIMEOUT) or {}
        else:
            info = await asyncio.wait_for(get_movie_info(title), timeout=TMDB_TIMEOUT) or {}
    except asyncio.TimeoutError:
        logger.warning("_build_card: TMDB timeout for %r (%s)", title, category)
        info = {}

    if category == "series":
        desc = _trim(info.get("overview", ""))
        caption = (
            f"📺 <b><code>{esc(info.get('title', title))}</code></b>\n\n"
            f"🗓 Дата выхода: {esc(str(info.get('release_date', '—')))}\n"
            f"⭐️ Рейтинг: {esc(str(info.get('rating', '—')))}\n"
            f"🎭 Жанры: {esc(info.get('genres', '—'))}\n"
            f"👥 Актёры: {esc(info.get('actors', '—'))}\n"
            f"📚 Сезонов: {esc(str(info.get('seasons', '—')))}\n"
            f"🎥 Эпизодов: {esc(str(info.get('episodes', '—')))}\n\n"
            f"📖 {esc(desc)}"
        )
    else:
        desc = _trim(info.get("overview", ""))
        emoji = "🎬" if category == "movies" else "🎥"
        caption = (
            f"{emoji} <b><code>{esc(info.get('title', title))}</code></b>\n\n"
            f"🗓 Дата выхода: {esc(str(info.get('release_date', '—')))}\n"
            f"⭐️ Рейтинг: {esc(str(info.get('rating', '—')))}\n"
            f"⏳ Длительность: {esc(str(info.get('runtime', '—')))} мин.\n"
            f"🎭 Жанры: {esc(info.get('genres', '—'))}\n"
            f"👥 Актёры: {esc(info.get('actors', '—'))}\n\n"
            f"📖 {esc(desc)}"
        )
    return caption, info.get("poster_url")


def _trim(text: str, limit: int = 900) -> str:
    text = re.sub(r"<[^>]+>", "", text or "")
    return text[:limit] + "…" if len(text) > limit else text


@router.callback_query(ConfirmCB.filter())
async def confirm_cb(call: CallbackQuery, callback_data: ConfirmCB) -> None:
    if not isinstance(call.message, Message):
        return
    await call.answer()

    cat = CODE_TO_CAT[callback_data.code]
    chat_id = call.message.chat.id
    item = _resolve_title(chat_id, callback_data.title)

    reply_kb = sequel_kb(cat, item)
    text_to_send = f"🎬 Добавить продолжение для <b>{esc(item)}</b>?"

    try:
        if call.message.photo or call.message.document or call.message.video or call.message.animation:
            await call.message.edit_caption(
                caption=text_to_send,
                reply_markup=reply_kb,
            )
        else:
            await call.message.edit_text(
                text=text_to_send,
                reply_markup=reply_kb,
            )
    except TelegramBadRequest as e:
        logger.warning("confirm_cb: edit failed for %r, falling back to delete+answer: %s", item, e)
        try:
            await call.message.delete()
        except TelegramBadRequest as e2:
            logger.warning("confirm_cb: failed to delete message: %s", e2)
        await call.message.answer(
            text=text_to_send,
            reply_markup=reply_kb,
        )


@router.callback_query(SequelYesCB.filter())
async def sequel_yes(call: CallbackQuery, callback_data: SequelYesCB) -> None:
    if not isinstance(call.message, Message):
        return
    await call.answer()
    cat = CODE_TO_CAT[callback_data.code]
    chat_id = call.message.chat.id
    item = _resolve_title(chat_id, callback_data.title)

    m = re.search(r"(.+?)\s(\d+)$", item)
    new_item = f"{m.group(1)} {int(m.group(2)) + 1}" if m else f"{item} 2"

    await delete_item(cat, item)
    await add_item(cat, new_item)

    text_to_send = f"🔄 <b>{esc(item)}</b> → <b>{esc(new_item)}</b>\n\nВыберите действие в меню."

    if call.message.photo or call.message.document or call.message.video or call.message.animation:
        await call.message.edit_caption(caption=text_to_send, reply_markup=None)
    else:
        await call.message.edit_text(text=text_to_send, reply_markup=None)


@router.callback_query(SequelNoCB.filter())
async def sequel_no(call: CallbackQuery, callback_data: SequelNoCB) -> None:
    if not isinstance(call.message, Message):
        return
    await call.answer()
    cat = CODE_TO_CAT[callback_data.code]
    ru = CAT_RU.get(cat, cat)
    chat_id = call.message.chat.id
    item = _resolve_title(chat_id, callback_data.title)

    await delete_item(cat, item)
    text_to_send = f"❌ <b>{esc(item)}</b> удалён из «{ru}»."

    # Аналогично sequel_yes: редактируем caption на месте, без delete+answer.
    if call.message.photo or call.message.document or call.message.video or call.message.animation:
        await call.message.edit_caption(caption=text_to_send, reply_markup=None)
    else:
        await call.message.edit_text(text=text_to_send, reply_markup=None)


@router.callback_query(EditMenuCB.filter())
async def edit_menu_cb(call: CallbackQuery, callback_data: EditMenuCB) -> None:
    if not isinstance(call.message, Message):
        return
    await call.answer()
    cat = CODE_TO_CAT[callback_data.code]
    ru = CAT_RU.get(cat, cat)
    items = await get_items(cat)
    text = "\n".join(f"{i + 1}. {esc(x)}" for i, x in enumerate(items)) if items else "(список пуст)"
    await call.message.edit_text(
        f"✏️ <b>{ru}</b> — управление списком:\n\n{text}",
        reply_markup=edit_menu_kb(cat),
    )


@router.callback_query(AddItemCB.filter())
async def add_item_start(call: CallbackQuery, callback_data: AddItemCB, state: FSMContext) -> None:
    if not isinstance(call.message, Message):
        return
    await call.answer()
    cat = CODE_TO_CAT[callback_data.code]
    ru = CAT_RU.get(cat, cat)
    await state.set_state(AddItemStates.waiting_title)
    await state.update_data(category=cat)
    await call.message.edit_text(
        f"✏️ Введите название для добавления в <b>{ru}</b>:\n\n<i>Для отмены — /start</i>",
        reply_markup=None,
    )


@router.callback_query(DeleteMenuCB.filter())
async def delete_menu(call: CallbackQuery, callback_data: DeleteMenuCB) -> None:
    if not isinstance(call.message, Message):
        return
    await call.answer()
    cat = CODE_TO_CAT[callback_data.code]
    ru = CAT_RU.get(cat, cat)
    items = await get_items(cat)
    if not items:
        await call.message.edit_text(f"❌ Список «<b>{ru}</b>» пуст.", reply_markup=edit_menu_kb(cat))
        return
    await call.message.edit_text(f"🗑 Удалить из «<b>{ru}</b>»:", reply_markup=delete_list_kb(cat, items))


@router.callback_query(DeleteItemCB.filter())
async def delete_item_cb(call: CallbackQuery, callback_data: DeleteItemCB) -> None:
    if not isinstance(call.message, Message):
        return
    await call.answer()
    cat = CODE_TO_CAT[callback_data.code]
    ru = CAT_RU.get(cat, cat)
    items = await get_items(cat)
    if 0 <= callback_data.idx < len(items):
        title = items[callback_data.idx]
        await delete_item(cat, title)
        items = await get_items(cat)
        if items:
            await call.message.edit_text(
                f"🗑 Удалить из «<b>{ru}</b>»:\n<i>({esc(title)} удалён)</i>",
                reply_markup=delete_list_kb(cat, items),
            )
        else:
            await call.message.edit_text(
                f"✅ <b>{esc(title)}</b> удалён. Список «{ru}» теперь пуст.",
                reply_markup=edit_menu_kb(cat),
            )
    else:
        await call.answer("⚠ Ошибка удаления.", show_alert=True)


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
                await call.message.edit_caption(caption="Возврат в меню...", reply_markup=None)
            else:
                await call.message.edit_text("Возврат в меню...", reply_markup=None)
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
                await call.message.edit_caption(caption=f"🎲 Категория: <b>{ru}</b>", reply_markup=spin_kb(cat))
        else:
            await call.message.edit_text(f"🎲 Категория: <b>{ru}</b>", reply_markup=spin_kb(cat))


@router.message(AddItemStates.waiting_title, F.text & ~F.text.startswith("/"))
async def handle_pending_add(msg: Message, state: FSMContext) -> None:
    data = await state.get_data()
    cat = data.get("category")
    await state.clear()
    if not cat:
        return

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
