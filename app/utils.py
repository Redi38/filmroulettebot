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


def stars(rating) -> str:
    """Render a TMDB 0-10 rating as a 5-star bar, e.g. 7.8 -> '⭐⭐⭐⭐☆  7.8/10'.
    Falls back to '—' for missing/non-numeric ratings so callers don't need
    to special-case the "no data" case themselves."""
    try:
        value = float(rating)
    except (TypeError, ValueError):
        return "—"
    full = max(0, min(5, round(value / 2)))
    return f"{'⭐' * full}{'☆' * (5 - full)}  {value:.1f}/10"


async def smart_replace(
    message: Message,
    *,
    text: str | None = None,
    caption: str | None = None,
    photo: str | None = None,
    reply_markup=None,
) -> Message:
    """Единая точка обновления карточки/меню вместо разрозненных
    try/except TelegramBadRequest -> delete+answer, разбросанных по хендлерам.

    Решает, как обновить сообщение, в зависимости от того, чем оно является
    сейчас и чем должно стать:
    - text -> text: edit_text на месте.
    - media -> media (тот же тип контента): edit_caption на месте.
    - text -> photo (переход в карточку с постером) или наоборот: edit
      невозможен технически (Telegram не даёт менять тип контента), поэтому
      явно делаем delete+answer, не полагаясь на except как на "план Б".
    Если Telegram всё же откажет по любой другой причине (сообщение слишком
    старое, права и т.п.), пытаемся восстановиться тем же delete+answer,
    логируя причину — так поведение единообразно предсказуемо для юзера,
    а не "то мигает на месте, то прыгает вниз чата" в зависимости от хендлера.
    """
    has_media = bool(message.photo or message.document or message.video or message.animation)
    try:
        if photo and not has_media:
            await message.delete()
            return await message.answer_photo(photo, caption=caption, reply_markup=reply_markup)
        if has_media:
            await message.edit_caption(caption=caption if caption is not None else text, reply_markup=reply_markup)
            return message
        await message.edit_text(text or "", reply_markup=reply_markup)
        return message
    except TelegramBadRequest as e:
        if "message is not modified" in str(e):
            return message
        logger.warning("smart_replace: falling back to delete+answer: %s", e)
        try:
            await message.delete()
        except TelegramBadRequest as e2:
            logger.warning("smart_replace: failed to delete message: %s", e2)
        if photo:
            return await message.answer_photo(photo, caption=caption, reply_markup=reply_markup)
        return await message.answer(text or caption or "", reply_markup=reply_markup)


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
