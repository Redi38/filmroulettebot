"""Movie/series roulette: spinning, editing lists, confirming picks.

Split across spin.py (roll triggers), confirm.py (confirm-pick + sequel),
and edit.py (list management) — all decorating handlers onto the single
`router` from common.py. Importing the submodules here is what registers
their handlers; main.py only needs `roulette.router`, same as before the split.
"""
from __future__ import annotations

from . import (  # noqa: F401 — import side effect: registers handlers
    confirm,
    delete,
    edit,
    spin,
)
from .common import router

__all__ = ["router"]
