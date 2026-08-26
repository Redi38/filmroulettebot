"""Keyboards and CallbackData factories."""
from __future__ import annotations

from typing import Literal

from aiogram.filters.callback_data import CallbackData
from aiogram.types import (
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    KeyboardButton,
    ReplyKeyboardMarkup,
)

from app.utils import paginate

# ─── Constants ─────────────────────────────────────────────────────────────────
CAT_TO_CODE: dict[str, str] = {"movies": "m", "cartoons": "c", "series": "s", "dc": "dc", "marvel": "mv"}
CODE_TO_CAT = {v: k for k, v in CAT_TO_CODE.items()}
CAT_RU: dict[str, str] = {"movies": "Фильмы 🎬", "cartoons": "Мульты 🎥", "series": "Сериалы 📺", "dc": "DC 🦇", "marvel": "Marvel 🕷"}

# ─── CallbackData ──────────────────────────────────────────────────────────────
class SpinCB(CallbackData, prefix="sp"): code: str
class RerollCB(CallbackData, prefix="rr"): code: str
class ConfirmCB(CallbackData, prefix="cf"): code: str; title: str
class EditMenuCB(CallbackData, prefix="em"): code: str
class AddItemCB(CallbackData, prefix="ad"): code: str
class DeleteMenuCB(CallbackData, prefix="dlm"): code: str
class DeleteItemCB(CallbackData, prefix="del"): code: str; idx: int; page: int = 1
class SequelYesCB(CallbackData, prefix="sqy"): code: str; title: str
class SequelNoCB(CallbackData, prefix="sqn"): code: str; title: str
class BackMainCB(CallbackData, prefix="bk"): target: str
class UpcomingMoveCB(CallbackData, prefix="up"): action: str
class UpcomingSelectCB(CallbackData, prefix="upsel"): idx: int
class UpcomingDeleteOneCB(CallbackData, prefix="updel"): idx: int; page: int = 1
class UpcomingMoveTargetCB(CallbackData, prefix="upmv"): code: str
class UpcomingCheckMoveCB(CallbackData, prefix="upck"): title_idx: int
class UpcomingCheckMoveToCB(CallbackData, prefix="upckmv"): title_idx: int; code: str
class UpcomingAddCB(CallbackData, prefix="upadd"): pass
class CancelAddCB(CallbackData, prefix="cnadd"): code: str
class PageCB(CallbackData, prefix="pg"): scope: str; page: int
class NoopCB(CallbackData, prefix="noop"): pass

# ─── Helpers ───────────────────────────────────────────────────────────────────
ButtonStyle = Literal["primary", "success", "danger"]


def styled_btn(text: str, callback_data: str, style: ButtonStyle = "primary") -> InlineKeyboardButton:
    return InlineKeyboardButton(text=text, callback_data=callback_data, style=style)

def _back_row(cb_data: str, text: str = "⬅️ Назад") -> list[InlineKeyboardButton]:
    return [styled_btn(text=text, callback_data=cb_data, style="primary")]

def cancel_add_kb(code: str = "") -> InlineKeyboardMarkup:
    """Single "❌ Отмена" button shown while waiting for a title to add.
    code="" is used for the /upcoming add flow (no category to return to)."""
    return InlineKeyboardMarkup(inline_keyboard=[
        [styled_btn("❌ Отмена", CancelAddCB(code=code).pack(), "danger")]
    ])

def pagination_row(scope: str, page: int, total_pages: int) -> list[InlineKeyboardButton] | None:
    """Prev/page-indicator/next row. Returns None if there's nothing to paginate."""
    if total_pages <= 1:
        return None
    prev_cb = PageCB(scope=scope, page=page - 1).pack() if page > 1 else NoopCB().pack()
    next_cb = PageCB(scope=scope, page=page + 1).pack() if page < total_pages else NoopCB().pack()
    return [
        styled_btn("◀️", prev_cb, "primary"),
        styled_btn(f"{page}/{total_pages}", NoopCB().pack(), "primary"),
        styled_btn("▶️", next_cb, "primary"),
    ]

# ─── Reply keyboard ────────────────────────────────────────────────────────────
def main_kb() -> ReplyKeyboardMarkup:
    return ReplyKeyboardMarkup(
        keyboard=[
            [KeyboardButton(text="🎬 Рулетка Фильм")],
            [KeyboardButton(text="📺 Рулетка Сериал"), KeyboardButton(text="🎥 Рулетка Мульт")],
            [KeyboardButton(text="🔄 Начать")],
        ],
        resize_keyboard=True,
        is_persistent=True,
        input_field_placeholder="Выберите действие…",
    )

# ─── Inline keyboards ──────────────────────────────────────────────────────────
def spin_kb(cat: str) -> InlineKeyboardMarkup:
    code = CAT_TO_CODE[cat]
    return InlineKeyboardMarkup(inline_keyboard=[
        [styled_btn("🎰 Крутить", SpinCB(code=code).pack(), "success"),
         styled_btn("✏️ Изменить", EditMenuCB(code=code).pack(), "primary")],
        _back_row(BackMainCB(target="main").pack())
    ])

def after_roll_kb(cat: str, choice: str) -> InlineKeyboardMarkup:
    code = CAT_TO_CODE[cat]
    short_title = choice[:30].replace(":", "")
    return InlineKeyboardMarkup(inline_keyboard=[
        [styled_btn("✅ Подтвердить", ConfirmCB(code=code, title=short_title).pack(), "success"),
         styled_btn("🔄 Перекрутить", RerollCB(code=code).pack(), "danger")],
        _back_row(BackMainCB(target="main").pack())
    ])

def edit_menu_kb(cat: str, page_row: list[InlineKeyboardButton] | None = None) -> InlineKeyboardMarkup:
    code = CAT_TO_CODE[cat]
    rows: list[list[InlineKeyboardButton]] = []
    if page_row:
        rows.append(page_row)
    rows.append([styled_btn("➕ Добавить", AddItemCB(code=code).pack(), "success"),
                 styled_btn("➖ Удалить", DeleteMenuCB(code=code).pack(), "danger")])
    if cat not in ("dc", "marvel"):
        rows.append(_back_row(BackMainCB(target=f"sp__{code}").pack()))
    return InlineKeyboardMarkup(inline_keyboard=rows)

DELETE_PAGE_SIZE = 30

def delete_list_kb(cat: str, items: list[str], page: int = 1) -> InlineKeyboardMarkup:
    code = CAT_TO_CODE[cat]
    page_items, page, total_pages = paginate(items, page, page_size=DELETE_PAGE_SIZE)
    start = (page - 1) * DELETE_PAGE_SIZE
    rows = [
        [styled_btn(f"🗑 {item[:60]}", DeleteItemCB(code=code, idx=start + i, page=page).pack(), "danger")]
        for i, item in enumerate(page_items)
    ]
    row = pagination_row(f"del_{code}", page, total_pages)
    if row:
        rows.append(row)
    rows.append(_back_row(EditMenuCB(code=code).pack()))
    return InlineKeyboardMarkup(inline_keyboard=rows)

def sequel_kb(cat: str, title: str) -> InlineKeyboardMarkup:
    code = CAT_TO_CODE[cat]
    short_title = title[:30].replace(":", "")
    return InlineKeyboardMarkup(inline_keyboard=[[
        styled_btn("✅ Да", SequelYesCB(code=code, title=short_title).pack(), "success"),
        styled_btn("❌ Нет", SequelNoCB(code=code, title=short_title).pack(), "danger"),
    ]])

def upcoming_menu_kb(page_row: list[InlineKeyboardButton] | None = None) -> InlineKeyboardMarkup:
    rows: list[list[InlineKeyboardButton]] = []
    if page_row:
        rows.append(page_row)
    rows.append([styled_btn("➕ Добавить", UpcomingAddCB().pack(), "success"),
                 styled_btn("📤 Перенести", UpcomingMoveCB(action="move").pack(), "primary"),
                 styled_btn("🗑 Удалить", UpcomingMoveCB(action="del").pack(), "danger")])
    rows.append([styled_btn("🔍 Проверить вышедшие", UpcomingMoveCB(action="check").pack(), "success")])
    rows.append(_back_row(BackMainCB(target="main").pack()))
    return InlineKeyboardMarkup(inline_keyboard=rows)

def upcoming_list_kb(items: list[str]) -> InlineKeyboardMarkup:
    rows = [[styled_btn(f"📂 {title[:60]}", UpcomingSelectCB(idx=i).pack(), "primary")] for i, title in enumerate(items)]
    rows.append(_back_row(BackMainCB(target="up").pack()))
    return InlineKeyboardMarkup(inline_keyboard=rows)

def upcoming_delete_kb(items: list[str], page: int = 1) -> InlineKeyboardMarkup:
    page_items, page, total_pages = paginate(items, page, page_size=DELETE_PAGE_SIZE)
    start = (page - 1) * DELETE_PAGE_SIZE
    rows = [
        [styled_btn(f"🗑 {title[:60]}", UpcomingDeleteOneCB(idx=start + i, page=page).pack(), "danger")]
        for i, title in enumerate(page_items)
    ]
    row = pagination_row("updel", page, total_pages)
    if row:
        rows.append(row)
    rows.append(_back_row(BackMainCB(target="up").pack()))
    return InlineKeyboardMarkup(inline_keyboard=rows)

def upcoming_targets_kb() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[
        [styled_btn("🎬 Фильмы", UpcomingMoveTargetCB(code="m").pack(), "primary"),
         styled_btn("🎥 Мульты", UpcomingMoveTargetCB(code="c").pack(), "success"),
         styled_btn("📺 Сериалы", UpcomingMoveTargetCB(code="s").pack(), "primary")],
        _back_row(BackMainCB(target="upsel").pack())
    ])

def released_check_kb(released_items: list[dict]) -> InlineKeyboardMarkup:
    rows = [[styled_btn(f"🟢 {item['tmdb_title'][:50]}", UpcomingCheckMoveCB(title_idx=i).pack(), "success")] for i, item in enumerate(released_items)]
    rows.append(_back_row(BackMainCB(target="up").pack(), text="⬅️ К списку ожидаемых"))
    return InlineKeyboardMarkup(inline_keyboard=rows)

def released_move_to_kb(idx: int) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[
        [styled_btn("🎬 В Фильмы", UpcomingCheckMoveToCB(title_idx=idx, code="m").pack(), "primary"),
         styled_btn("🎥 В Мульты", UpcomingCheckMoveToCB(title_idx=idx, code="c").pack(), "success"),
         styled_btn("📺 В Сериалы", UpcomingCheckMoveToCB(title_idx=idx, code="s").pack(), "primary")],
        _back_row(UpcomingMoveCB(action="check").pack())
    ])
