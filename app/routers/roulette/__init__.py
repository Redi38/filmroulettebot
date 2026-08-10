"""Movie/series roulette: spinning, editing lists, confirming picks.

Split across spin.py (roll triggers), confirm.py (confirm-pick + sequel),
and edit.py (list management) — all decorating handlers onto the single
`router` from common.py. Importing the submodules here is what registers
their handlers; main.py only needs `roulette.router`, same as before the split.
"""
from __future__ import annotations

from .common import router
from . import spin, confirm, edit, delete  # noqa: F401 — import side effect: registers handlers

__all__ = ["router"]
