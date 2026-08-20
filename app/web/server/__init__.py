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

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.db.database import init_db

from . import (
    routes_core,
    routes_history,
    routes_items,
    routes_media,
    routes_showcase,
    routes_spin,
    routes_theaters,
    routes_upcoming,
)
from .shared import STATIC_DIR

logger = logging.getLogger(__name__)

app = FastAPI(title="Filmroulette Web")


@app.on_event("startup")
async def _startup() -> None:
    await init_db()


for _router_module in (
    routes_core,
    routes_history,
    routes_upcoming,
    routes_items,
    routes_spin,
    routes_showcase,
    routes_theaters,
    routes_media,
):
    app.include_router(_router_module.router)

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
