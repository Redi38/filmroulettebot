"""Shared utilities."""
import html
import logging
from urllib.parse import quote_plus

from aiogram.exceptions import TelegramBadRequest
from aiogram.types import Message

from app.config import settings

logger = logging.getLogger(__name__)

DEFAULT_PAGE_SIZE = 20


def esc(text: str) -> str:
    """Escape HTML special characters."""
    return html.escape(str(text))


async def safe_edit_text(message: Message, text: str, reply_markup=None) -> None:
    """edit_text wrapper that swallows Telegram's "message is not modified"
    error — this happens whenever a user taps a button that would render the
    exact same text+keyboard already on screen (e.g. double-tapping a menu
    button when the underlying list hasn't changed). It's harmless and not
    worth crashing the handler over; any other TelegramBadRequest is a real
    problem and re-raised.
    """
    try:
        await message.edit_text(text, reply_markup=reply_markup)
    except TelegramBadRequest as e:
        if "message is not modified" not in str(e):
            raise


async def safe_edit_caption(message: Message, caption: str, reply_markup=None) -> None:
    """Same as safe_edit_text but for photo captions (edit_caption)."""
    try:
        await message.edit_caption(caption=caption, reply_markup=reply_markup)
    except TelegramBadRequest as e:
        if "message is not modified" not in str(e):
            raise


def build_watch_link(title: str) -> str | None:
    """Build the "смотреть" link for a title using WATCH_LINK_TEMPLATE from
    config/.env, e.g. WATCH_LINK_TEMPLATE=https://kinogo.my/index.php?do=search&subaction=search&story={query}
    Returns None if no template is configured."""
    template = settings.WATCH_LINK_TEMPLATE
    if not template:
        return None
    return template.format(query=quote_plus(title))


def paginate(items: list[str], page: int, page_size: int = DEFAULT_PAGE_SIZE) -> tuple[list[str], int, int]:
    """Clamp `page` (1-based) into range and slice `items` for that page.

    Returns (page_items, clamped_page, total_pages). total_pages is at least 1
    even for an empty list, so callers don't need to special-case it.
    """
    total_pages = max(1, (len(items) + page_size - 1) // page_size)
    page = max(1, min(page, total_pages))
    start = (page - 1) * page_size
    return items[start:start + page_size], page, total_pages


def render_numbered_list(items: list[str], page: int, page_size: int = DEFAULT_PAGE_SIZE, code: bool = False) -> str:
    """Render a page of items as a numbered list, numbering continuing across pages.

    If `code` is True, each title is wrapped in <code> tags so tapping it
    copies the title (used for DC/Marvel lists where copying titles is handy).
    """
    page_items, page, _ = paginate(items, page, page_size)
    if not page_items:
        return "(список пуст)"
    start_num = (page - 1) * page_size + 1
    if code:
        return "\n".join(f"{start_num + i}. <code>{esc(t)}</code>" for i, t in enumerate(page_items))
    return "\n".join(f"{start_num + i}. {esc(t)}" for i, t in enumerate(page_items))


def render_paginated_list(
    items: list[str], page: int, page_size: int = DEFAULT_PAGE_SIZE, code: bool = False,
) -> tuple[str, int, int]:
    """paginate() + render_numbered_list() combined — this exact pair was
    repeated identically at every paginated list screen (/dc, /marvel,
    /upcoming, edit-list preview). Returns (body_text, clamped_page, total_pages);
    callers still build their own header text and pagination_row/keyboard —
    those differ per screen and pagination_row lives in keyboards.py, which
    already imports from this module, so pulling it in here would be circular.
    """
    _, page, total_pages = paginate(items, page, page_size)
    body = render_numbered_list(items, page, page_size, code=code)
    return body, page, total_pages
