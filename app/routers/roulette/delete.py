"""Delete flow: delete menu (paginated) and single-item delete."""
from __future__ import annotations

from aiogram import F
from aiogram.types import Message, CallbackQuery

from app.db.database import get_items, delete_item
from app.keyboards import edit_menu_kb, delete_list_kb, DeleteMenuCB, DeleteItemCB, PageCB, CODE_TO_CAT, CAT_RU
from app.utils import esc, safe_edit_text

from .common import router


@router.callback_query(DeleteMenuCB.filter())
async def delete_menu(call: CallbackQuery, callback_data: DeleteMenuCB) -> None:
    if not isinstance(call.message, Message):
        return
    await call.answer()
    cat = CODE_TO_CAT[callback_data.code]
    ru = CAT_RU.get(cat, cat)
    items = await get_items(cat)
    if not items:
        await safe_edit_text(call.message, f"❌ Список «<b>{ru}</b>» пуст.", reply_markup=edit_menu_kb(cat))
        return
    await safe_edit_text(call.message, f"🗑 Удалить из «<b>{ru}</b>»:", reply_markup=delete_list_kb(cat, items))


@router.callback_query(PageCB.filter(F.scope.startswith("del_")))
async def delete_list_page(call: CallbackQuery, callback_data: PageCB) -> None:
    if not isinstance(call.message, Message):
        return
    await call.answer()
    code = callback_data.scope.removeprefix("del_")
    cat = CODE_TO_CAT.get(code)
    if cat is None:
        return
    ru = CAT_RU.get(cat, cat)
    items = await get_items(cat)
    if not items:
        await safe_edit_text(call.message, f"❌ Список «<b>{ru}</b>» пуст.", reply_markup=edit_menu_kb(cat))
        return
    await safe_edit_text(
        call.message,
        f"🗑 Удалить из «<b>{ru}</b>»:",
        reply_markup=delete_list_kb(cat, items, page=callback_data.page),
    )


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
            # Остаёмся на той же странице, с которой удаляли — иначе после
            # удаления с 3-й страницы список из 40+ тайтлов всегда прыгал бы
            # обратно на первую.
            await safe_edit_text(
                call.message,
                f"🗑 Удалить из «<b>{ru}</b>»:\n<i>({esc(title)} удалён)</i>",
                reply_markup=delete_list_kb(cat, items, page=callback_data.page),
            )
        else:
            await safe_edit_text(
                call.message,
                f"✅ <b>{esc(title)}</b> удалён. Список «{ru}» теперь пуст.",
                reply_markup=edit_menu_kb(cat),
            )
    else:
        await call.answer("⚠ Ошибка удаления.", show_alert=True)
