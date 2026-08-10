"""Shared router instance, in-memory state, and small helpers used by
list.py / move.py / check.py.
"""
from __future__ import annotations

import logging
import time
from datetime import datetime
from typing import Any

from aiogram import Router

logger = logging.getLogger(__name__)
router = Router()

_up_sel_title: dict[int, str] = {}
_check_cache: dict[int, list[dict[str, Any]]] = {}

_last_check_at: dict[int, float] = {}
CHECK_COOLDOWN = 60  # seconds


def _fmt_date(date_str: str) -> str:
    try:
        return datetime.strptime(date_str, "%Y-%m-%d").strftime("%d.%m.%Y")
    except ValueError:
        return date_str


def _days_label(days_ago: int) -> str:
    if days_ago > 0:
        return f"{days_ago} дн. назад"
    elif days_ago == 0:
        return "сегодня"
    else:
        return f"через {-days_ago} дн."
