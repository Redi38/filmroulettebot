"""Web version of the roulette: FastAPI backend reusing the exact same
database layer, TMDb service, and kinogo-link resolver the Telegram bot
uses. No auth by design (keep the URL private) — see docker-compose.yml
for the service that runs this alongside the bot, sharing the SQLite file
over a volume.

Split by concern into sibling modules under routes/ (core/history/upcoming/
items/tracked_series/spin/showcase/theaters/settings/media); this file just
assembles them onto a single FastAPI app, so `uvicorn app.web.server:app`
keeps working unchanged.
"""
from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.staticfiles import StaticFiles

from app.db.database import close_db, init_db

from .routes import (
    core,
    history,
    home,
    items,
    media,
    settings,
    showcase,
    spin,
    theaters,
    tracked_series,
    upcoming,
)
from .shared.constants import STATIC_DIR

logger = logging.getLogger(__name__)


@asynccontextmanager
async def _lifespan(_app: FastAPI) -> AsyncIterator[None]:
    await init_db()
    yield
    await close_db()


app = FastAPI(title="Filmroulette Web", lifespan=_lifespan)


# Registration order matters: FastAPI matches routes in the order they're
# added, so a literal path (e.g. tracked_series's /api/tracked-series/add)
# must be registered before a wildcard pattern that could also match it
# (items's /api/{cat}/add) — otherwise the wildcard route wins and the
# literal one 404s via _check_category rejecting "tracked-series" as an
# unknown category.
for _router_module in (
    core,
    history,
    home,
    upcoming,
    tracked_series,
    items,
    spin,
    showcase,
    theaters,
    settings,
    media,
):
    app.include_router(_router_module.router)

app.add_middleware(GZipMiddleware, minimum_size=1024)


@app.middleware("http")
async def _static_cache_headers(request: Request, call_next):
    """Cache policy for /static. Bundles under dist/ are requested with the
    content hash index.html stamped onto them (see shared/assets.py), so a
    given URL never changes meaning and can be cached forever; everything
    else under /static (favicons, fonts) gets a modest max-age and
    revalidates."""
    response = await call_next(request)
    path = request.url.path
    if path.startswith("/static/") and "Cache-Control" not in response.headers:
        if "/dist/" in path and request.query_params.get("v"):
            response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        else:
            response.headers["Cache-Control"] = "public, max-age=3600, must-revalidate"
    return response


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
