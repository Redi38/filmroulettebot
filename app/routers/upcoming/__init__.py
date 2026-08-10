"""Upcoming-movies management, split across list.py / move.py / check.py,
all decorating handlers onto the single `router` from common.py.
main.py only needs `upcoming.router`, same as before the split.
"""
from __future__ import annotations

from .common import router
from . import listing, move, check  # noqa: F401 — import side effect: registers handlers

__all__ = ["router"]
