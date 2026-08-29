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

from fastapi import FastAPI
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
from .shared import STATIC_DIR

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

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
