"""DC and Marvel franchise list commands (paginated, /dc /marvel)."""
from __future__ import annotations

from aiogram import Router, F
from aiogram.filters import Command
from aiogram.types import Message, CallbackQuery

from app.db.database import get_items
from app.keyboards import edit_menu_kb, pagination_row, PageCB, NoopCB
from app.utils import render_paginated_list, safe_edit_text

router = Router()

_TITLES = {"dc": "🦇 DC", "marvel": "🕷 Marvel"}


async def _render(cat: str, page: int) -> tuple[str, int]:
    items = await get_items(cat)
    body, page, total_pages = render_paginated_list(items, page, code=True)
    text = f"{_TITLES[cat]}:\n{body}"
    return text, total_pages


@router.message(Command("dc"))
async def dc_cmd(msg: Message) -> None:
    text, total_pages = await _render("dc", 1)
    row = pagination_row("dc", 1, total_pages)
    await msg.answer(text, reply_markup=edit_menu_kb("dc", row))


@router.message(Command("marvel"))
async def marvel_cmd(msg: Message) -> None:
    text, total_pages = await _render("marvel", 1)
    row = pagination_row("marvel", 1, total_pages)
    await msg.answer(text, reply_markup=edit_menu_kb("marvel", row))


@router.callback_query(PageCB.filter(F.scope.in_(("dc", "marvel"))))
async def dc_marvel_page(call: CallbackQuery, callback_data: PageCB) -> None:
    if not isinstance(call.message, Message):
        return
    await call.answer()
    cat = callback_data.scope
    text, total_pages = await _render(cat, callback_data.page)
    row = pagination_row(cat, callback_data.page, total_pages)
    await safe_edit_text(call.message, text, reply_markup=edit_menu_kb(cat, row))


@router.callback_query(NoopCB.filter())
async def noop_cb(call: CallbackQuery) -> None:
    await call.answer()
