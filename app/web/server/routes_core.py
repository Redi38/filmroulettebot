"""Index page, category summary, and the confirm-with-sequel action."""
from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import FileResponse

from app.db.database import add_item, delete_item, get_items
from app.services.titles import next_sequel_title

from .shared import CATEGORIES, CATEGORY_SHORT, STATIC_DIR, SequelBody, _check_category

router = APIRouter()


@router.get("/")
async def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


@router.get("/api/categories")
async def api_categories() -> dict:
    out = {}
    for code, ru in CATEGORIES.items():
        items = await get_items(code)
        out[code] = {"label": ru, "short_label": CATEGORY_SHORT.get(code, ru), "count": len(items)}
    return out


@router.post("/api/{cat}/sequel")
async def api_sequel(cat: str, body: SequelBody) -> dict:
    """Confirm-with-sequel: rename "Title" -> "Title 2" (or bump the number),
    same rule the bot's "✅ Да, сиквел" button uses."""
    _check_category(cat)
    item = body.title
    new_item = next_sequel_title(item)
    await delete_item(cat, item)
    await add_item(cat, new_item)
    return {"ok": True, "new_title": new_item}
