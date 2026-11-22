"""Click-to-expand detail card for a showcase/theaters row, keyed by TMDb
id+type rather than title search."""
from __future__ import annotations

import re

import httpx
from fastapi import APIRouter, HTTPException, Response

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


# Browsers on networks/DNS resolvers that block image.tmdb.org (e.g. some
# Ukrainian filtering DNS) can't load posters straight from TMDb's CDN, so the
# frontend routes them through this same-origin proxy instead.
_IMG_SIZE_RE = re.compile(r"^(w\d{2,4}|original)$")
_IMG_FILE_RE = re.compile(r"^[A-Za-z0-9_-]+\.(jpg|jpeg|png|webp)$")
_img_client: httpx.AsyncClient | None = None


@router.get("/api/img/{size}/{filename}")
async def api_tmdb_image(size: str, filename: str) -> Response:
    if not _IMG_SIZE_RE.match(size) or not _IMG_FILE_RE.match(filename):
        raise HTTPException(404, "Not found")
    global _img_client
    if _img_client is None:
        _img_client = httpx.AsyncClient(timeout=10)
    try:
        r = await _img_client.get(f"https://image.tmdb.org/t/p/{size}/{filename}")
    except httpx.HTTPError:
        raise HTTPException(502, "Image upstream unavailable")
    if r.status_code != 200:
        raise HTTPException(404 if r.status_code == 404 else 502, "Image not available")
    return Response(
        r.content,
        media_type=r.headers.get("content-type", "image/jpeg"),
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )
