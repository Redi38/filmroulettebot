"""Confirm-pick flow: "✅ Подтвердить" and the sequel yes/no follow-up."""
from __future__ import annotations

import re

from aiogram.types import Message, CallbackQuery
from aiogram.exceptions import TelegramBadRequest

from app.db.database import add_item, delete_item
from app.keyboards import sequel_kb, ConfirmCB, SequelYesCB, SequelNoCB, CODE_TO_CAT, CAT_RU
from app.utils import esc, safe_edit_text, safe_edit_caption

from .common import router, logger, _full_title_cache, _resolve_title


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

    try:
        if call.message.photo or call.message.document or call.message.video or call.message.animation:
            await safe_edit_caption(call.message, caption=text_to_send, reply_markup=reply_kb)
        else:
            await safe_edit_text(call.message, text=text_to_send, reply_markup=reply_kb)
    except TelegramBadRequest as e:
        logger.warning("confirm_cb: edit failed for %r, falling back to delete+answer: %s", item, e)
        _full_title_cache.pop((chat_id, call.message.message_id), None)
        try:
            await call.message.delete()
        except TelegramBadRequest as e2:
            logger.warning("confirm_cb: failed to delete message: %s", e2)
        new_msg = await call.message.answer(
            text=text_to_send,
            reply_markup=reply_kb,
        )
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

    # Редактируем сообщение на месте вместо delete+answer: Telegram не даёт
    # снять фото через edit, но зато caption редактируется гарантированно
    # в одном и том же сообщении — без риска, что delete() не пройдёт
    # (старое сообщение >48ч, нет прав и т.д.) и уведомление придёт отдельно.
    if call.message.photo or call.message.document or call.message.video or call.message.animation:
        await safe_edit_caption(call.message, caption=text_to_send, reply_markup=None)
    else:
        await safe_edit_text(call.message, text=text_to_send, reply_markup=None)
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

    # Аналогично sequel_yes: редактируем caption на месте, без delete+answer.
    if call.message.photo or call.message.document or call.message.video or call.message.animation:
        await safe_edit_caption(call.message, caption=text_to_send, reply_markup=None)
    else:
        await safe_edit_text(call.message, text=text_to_send, reply_markup=None)
    _full_title_cache.pop((chat_id, call.message.message_id), None)
