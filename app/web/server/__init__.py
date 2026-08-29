"""Web version of the roulette: FastAPI backend reusing the exact same
database layer, TMDb service, and kinogo-link resolver the Telegram bot
uses. No auth by design (keep the URL private) — see docker-compose.yml
for the service that runs this alongside the bot, sharing the SQLite file
over a volume.

Split by concern into sibling route modules (routes_core/history/upcoming/
items/spin/showcase/theaters/media); this file just assembles them onto a
single FastAPI app, so `uvicorn app.web.server:app` keeps working unchanged.
"""
from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.db.database import close_db, init_db

from . import (
    routes_core,
    routes_history,
    routes_home,
    routes_items,
    routes_media,
    routes_showcase,
    routes_spin,
    routes_theaters,
    routes_upcoming,
)
from .shared import STATIC_DIR

logger = logging.getLogger(__name__)


@asynccontextmanager
async def _lifespan(_app: FastAPI) -> AsyncIterator[None]:
    await init_db()
    yield
    await close_db()


app = FastAPI(title="Filmroulette Web", lifespan=_lifespan)


for _router_module in (
    routes_core,
    routes_history,
    routes_home,
    routes_upcoming,
    routes_items,
    routes_spin,
    routes_showcase,
    routes_theaters,
    routes_media,
):
    app.include_router(_router_module.router)

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
