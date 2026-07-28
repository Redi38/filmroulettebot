"""DC and Marvel list commands."""
from __future__ import annotations

from aiogram import Router
from aiogram.filters import Command
from aiogram.types import Message

from app.db.database import get_items
from app.keyboards import edit_menu_kb
from app.utils import esc

router = Router()


@router.message(Command("dc"))
async def dc_cmd(msg: Message) -> None:
    items = await get_items("dc")
    text = "\n".join(f"{i+1}. <code>{esc(x)}</code>" for i, x in enumerate(items)) if items else "(список пуст)"
    await msg.answer(f"🦇 DC:\n{text}", reply_markup=edit_menu_kb("dc"))


@router.message(Command("marvel"))
async def marvel_cmd(msg: Message) -> None:
    items = await get_items("marvel")
    text = "\n".join(f"{i+1}. <code>{esc(x)}</code>" for i, x in enumerate(items)) if items else "(список пуст)"
    await msg.answer(f"🕷 Marvel:\n{text}", reply_markup=edit_menu_kb("marvel"))
