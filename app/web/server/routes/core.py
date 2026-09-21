"""Index page, category summary, and the confirm-with-sequel action."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from fastapi.responses import HTMLResponse

from app.db.database import add_item, delete_item, get_item_counts
from app.services.titles import next_sequel_title

from ..shared.assets import render_index_html
from ..shared.bodies import SequelBody, SequelResponse
from ..shared.constants import CATEGORIES, CATEGORY_SHORT
from ..shared.validation import valid_category

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
    # One UNION ALL COUNT(*) query for every category instead of a full
    # `SELECT title FROM <table>` per category — this endpoint is fetched
    # on every page load (menu.js bootstrap), so it used to mean 7 full
    # table scans, whole-row results included, just to read off len().
    counts = await get_item_counts(list(CATEGORIES.keys()))
    out = {}
    for code, ru in CATEGORIES.items():
        out[code] = {"label": ru, "short_label": CATEGORY_SHORT.get(code, ru), "count": counts.get(code, 0)}
    return out


@router.post("/api/{cat}/sequel", response_model=SequelResponse)
async def api_sequel(body: SequelBody, cat: str = Depends(valid_category)) -> SequelResponse:
    """Confirm-with-sequel: rename "Title" -> "Title 2" (or bump the number),
    same rule the bot's "✅ Да, сиквел" button uses."""
    item = body.title
    new_item = next_sequel_title(item)
    await delete_item(cat, item)
    await add_item(cat, new_item)
    return SequelResponse(new_title=new_item)
