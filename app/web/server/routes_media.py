"""Click-to-expand detail card for a showcase/theaters row, keyed by TMDb
id+type rather than title search."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.services.tmdb import get_details_by_id
from app.services.watch_link import find_watch_page_url
from app.utils import build_watch_link

router = APIRouter()


@router.get("/api/media/{media_type}/{tmdb_id}")
async def api_media_details(media_type: str, tmdb_id: int) -> dict:
    """Full detail card for a showcase/theaters row — click-to-expand target,
    keyed by TMDb id+type since these rows don't come from the user's own
    lists (which use get_movie_info/get_series_info, title-search based)."""
    if media_type not in ("movie", "tv"):
        raise HTTPException(404, f"Unknown media type: {media_type}")
    details = await get_details_by_id(tmdb_id, is_series=media_type == "tv")
    if not details:
        raise HTTPException(404, "Not found")
    details["watch_link"] = await find_watch_page_url(details["title"]) or build_watch_link(details["title"])
    return details
