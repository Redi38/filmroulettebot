"""Movie/series roulette: spinning, editing lists, confirming picks."""
from __future__ import annotations

import asyncio
import logging
import random
import re
import time

from aiogram import Router, F
from aiogram.filters import CommandStart
from aiogram.fsm.context import FSMContext
from aiogram.types import Message, CallbackQuery
from aiogram.exceptions import TelegramBadRequest

from app.db.database import get_items, add_item, delete_item, save_history, item_exists
from app.states import AddItemStates
from app.keyboards import (
    main_kb, spin_kb, after_roll_kb, edit_menu_kb, sequel_kb, cancel_input_kb,
    SpinCB, RerollCB, ConfirmCB, EditMenuCB, AddItemCB, DeleteItemCB,
    SequelYesCB, SequelNoCB, CancelInputCB, BackMainCB, CODE_TO_CAT, CAT_RU,
)
from app.services.tmdb import get_movie_info, get_series_info
from app.services.watch_link import find_watch_page_url
from app.utils import esc, build_watch_link, safe_edit_text, safe_edit_caption, smart_replace, stars

logger = logging.getLogger(__name__)
router = Router()

_last_category: dict[int, str] = {}

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

    msg = await smart_replace(call.message, text="🌀 Перекручиваем…", caption="🌀 Перекручиваем…", reply_markup=None)
    await asyncio.sleep(0.6)
    await _spin_edit(msg, cat)


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


async def _fetch_tmdb_info(category: str, title: str) -> dict:
    try:
        if category == "series":
            return await asyncio.wait_for(get_series_info(title), timeout=TMDB_TIMEOUT) or {}
        return await asyncio.wait_for(get_movie_info(title), timeout=TMDB_TIMEOUT) or {}
    except asyncio.TimeoutError:
        logger.warning("_build_card: TMDB timeout for %r (%s)", title, category)
        return {}


async def _build_card(category: str, title: str) -> tuple[str, str, str | None]:
    tmdb_task = asyncio.create_task(_fetch_tmdb_info(category, title))
    kinogo_task = asyncio.create_task(find_watch_page_url(title))
    info, direct_link = await asyncio.gather(tmdb_task, kinogo_task)

    display_title = info.get("title", title)
    if direct_link:
        link = direct_link
    elif display_title != title:
        link = await find_watch_page_url(display_title) or build_watch_link(display_title)
    else:
        link = build_watch_link(display_title)
    link_line = f'\n\n🔗 <a href="{esc(link)}">Смотреть онлайн</a>' if link else ""

    cat_label = {"movies": "Рулетка · Фильмы", "cartoons": "Рулетка · Мульты", "series": "Рулетка · Сериалы"}
    breadcrumb = f"<i>{cat_label.get(category, 'Рулетка')}</i>\n"
    rating_line = f"⭐ Рейтинг: {stars(info.get('rating'))}\n"

    def _render(desc_limit: int) -> str:
        desc = _trim(info.get("overview", ""), desc_limit)
        if category == "series":
            return (
                f"{breadcrumb}"
                f"📺 <b><code>{esc(display_title)}</code></b>\n\n"
                f"{rating_line}"
                f"🗓 Дата выхода: {esc(str(info.get('release_date', '—')))}\n"
                f"🎭 Жанры: {esc(info.get('genres', '—'))}\n"
                f"👥 Актёры: {esc(info.get('actors', '—'))}\n\n"
                f"📚 Сезонов: {esc(str(info.get('seasons', '—')))}   "
                f"🎥 Эпизодов: {esc(str(info.get('episodes', '—')))}\n\n"
                f"───────────\n"
                f"📖 <i>{esc(desc)}</i>{link_line}"
            )
        emoji = "🎬" if category == "movies" else "🎥"
        return (
            f"{breadcrumb}"
            f"{emoji} <b><code>{esc(display_title)}</code></b>\n\n"
            f"{rating_line}"
            f"🗓 Дата выхода: {esc(str(info.get('release_date', '—')))}\n"
            f"⏳ Длительность: {esc(str(info.get('runtime', '—')))} мин.\n\n"
            f"🎭 Жанры: {esc(info.get('genres', '—'))}\n"
            f"👥 Актёры: {esc(info.get('actors', '—'))}\n\n"
            f"───────────\n"
            f"📖 <i>{esc(desc)}</i>{link_line}"
        )

    caption = _render(desc_limit=900)
    caption_short = _render(desc_limit=250)
    if len(caption_short) > 1024:
        caption_short = _render(desc_limit=80)
    return caption, caption_short, info.get("poster_url")


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
    item = _resolve_title(chat_id, call.message.message_id, callback_data.title)

    reply_kb = sequel_kb(cat, item)
    text_to_send = f"🎬 Добавить продолжение для <b>{esc(item)}</b>?"

    new_msg = await smart_replace(call.message, text=text_to_send, caption=text_to_send, reply_markup=reply_kb)
    if new_msg.message_id != call.message.message_id:
        _full_title_cache.pop((chat_id, call.message.message_id), None)
        _full_title_cache[(chat_id, new_msg.message_id)] = item


@router.callback_query(SequelYesCB.filter())
async def sequel_yes(call: CallbackQuery, callback_data: SequelYesCB) -> None:
    if not isinstance(call.message, Message):
        return
    await call.answer()
    cat = CODE_TO_CAT[callback_data.code]
    chat_id = call.message.chat.id
    item = _resolve_title(chat_id, call.message.message_id, callback_data.title)

    m = re.search(r"(.+?)\s(\d+)$", item)
    new_item = f"{m.group(1)} {int(m.group(2)) + 1}" if m else f"{item} 2"

    await delete_item(cat, item)
    await add_item(cat, new_item)

    text_to_send = f"🔄 <b>{esc(item)}</b> → <b>{esc(new_item)}</b>\n\nВыберите действие в меню."

    await smart_replace(call.message, text=text_to_send, caption=text_to_send, reply_markup=None)
    _full_title_cache.pop((chat_id, call.message.message_id), None)


@router.callback_query(SequelNoCB.filter())
async def sequel_no(call: CallbackQuery, callback_data: SequelNoCB) -> None:
    if not isinstance(call.message, Message):
        return
    await call.answer()
    cat = CODE_TO_CAT[callback_data.code]
    ru = CAT_RU.get(cat, cat)
    chat_id = call.message.chat.id
    item = _resolve_title(chat_id, call.message.message_id, callback_data.title)

    await delete_item(cat, item)
    text_to_send = f"❌ <b>{esc(item)}</b> удалён из «{ru}»."

    await smart_replace(call.message, text=text_to_send, caption=text_to_send, reply_markup=None)
    _full_title_cache.pop((chat_id, call.message.message_id), None)


@router.callback_query(EditMenuCB.filter())
async def edit_menu_cb(call: CallbackQuery, callback_data: EditMenuCB) -> None:
    if not isinstance(call.message, Message):
        return
    await call.answer()
    cat = CODE_TO_CAT[callback_data.code]
    ru = CAT_RU.get(cat, cat)
    items = await get_items(cat)
    if items:
        text = f"✏️ <b>{ru}</b> — нажмите на тайтл, чтобы удалить его:"
    else:
        text = f"✏️ <b>{ru}</b> — список пуст."
    await safe_edit_text(
        call.message,
        text,
        reply_markup=edit_menu_kb(cat, items=items),
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
    await safe_edit_text(
        call.message,
        f"✏️ Введите название для добавления в <b>{ru}</b>:",
        reply_markup=cancel_input_kb("main"),
    )


@router.callback_query(DeleteItemCB.filter())
async def delete_item_cb(call: CallbackQuery, callback_data: DeleteItemCB) -> None:
    """Удаление тайтла прямо с экрана редактирования списка (1 тап,
    без отдельного промежуточного экрана "Удалить")."""
    if not isinstance(call.message, Message):
        return
    cat = CODE_TO_CAT[callback_data.code]
    ru = CAT_RU.get(cat, cat)
    items = await get_items(cat)
    if not (0 <= callback_data.idx < len(items)):
        await call.answer("⚠ Ошибка удаления.", show_alert=True)
        return

    title = items[callback_data.idx]
    await delete_item(cat, title)
    await call.answer(f"🗑 Удалено: {title[:40]}")
    items = await get_items(cat)
    if items:
        await safe_edit_text(
            call.message,
            f"✏️ <b>{ru}</b> — нажмите на тайтл, чтобы удалить его:",
            reply_markup=edit_menu_kb(cat, items=items),
        )
    else:
        await safe_edit_text(
            call.message,
            f"✅ <b>{esc(title)}</b> удалён. Список «{ru}» теперь пуст.",
            reply_markup=edit_menu_kb(cat),
        )


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
            await smart_replace(call.message, text="Возврат в меню...", caption="Возврат в меню...", reply_markup=None)
        await call.message.answer("🎉 Выберите действие:", reply_markup=main_kb())
    elif target.startswith("sp__"):
        code = target[4:]
        cat = CODE_TO_CAT.get(code, "movies")
        ru = CAT_RU.get(cat, cat)
        text = f"🎲 Категория: <b>{ru}</b>"
        # переход из карточки (возможно, с фото) обратно в текстовое меню
        # категории — это смена типа контента, поэтому delete+answer, а не edit
        has_media = bool(call.message.photo or call.message.document or call.message.video or call.message.animation)
        if has_media:
            try:
                await call.message.delete()
                await call.message.answer(text, reply_markup=spin_kb(cat))
            except TelegramBadRequest as e:
                logger.warning("back_main: failed to delete photo message: %s", e)
                await safe_edit_caption(call.message, caption=text, reply_markup=spin_kb(cat))
        else:
            await safe_edit_text(call.message, text, reply_markup=spin_kb(cat))


@router.callback_query(CancelInputCB.filter(F.target == "main"))
async def cancel_add_item(call: CallbackQuery, state: FSMContext) -> None:
    if not isinstance(call.message, Message):
        return
    await state.clear()
    await call.answer("Отменено")
    try:
        await call.message.delete()
    except TelegramBadRequest as e:
        logger.warning("cancel_add_item: failed to delete message: %s", e)
    await call.message.answer("🎉 Выберите действие:", reply_markup=main_kb())


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
