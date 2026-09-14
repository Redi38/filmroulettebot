"""Index page, category summary, and the confirm-with-sequel action."""
from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import HTMLResponse

from app.db.database import add_item, delete_item, get_items
from app.services.titles import next_sequel_title

from ..shared import CATEGORIES, CATEGORY_SHORT, SequelBody, SequelResponse, _check_category
from ..shared.assets import render_index_html

router = APIRouter()


@router.get("/", response_class=HTMLResponse)
async def index() -> HTMLResponse:
    # index.html is a tiny template: the bundle URLs get a content-hash
    # query so browsers can cache them forever yet pick up every deploy,
    # and core/constants.js is inlined for the pre-bundle header title.
    # Never cached itself, so the hashes it carries are always current.
    return HTMLResponse(render_index_html(), headers={"Cache-Control": "no-cache"})


@router.get("/api/categories")
async def api_categories() -> dict:
    out = {}
    for code, ru in CATEGORIES.items():
        items = await get_items(code)
        out[code] = {"label": ru, "short_label": CATEGORY_SHORT.get(code, ru), "count": len(items)}
    return out


@router.post("/api/{cat}/sequel", response_model=SequelResponse)
async def api_sequel(cat: str, body: SequelBody) -> SequelResponse:
    """Confirm-with-sequel: rename "Title" -> "Title 2" (or bump the number),
    same rule the bot's "✅ Да, сиквел" button uses."""
    _check_category(cat)
    item = body.title
    new_item = next_sequel_title(item)
    await delete_item(cat, item)
    await add_item(cat, new_item)
    return SequelResponse(new_title=new_item)
