"""Canonical Russian category labels, shared by the web frontend
(app/web/server/) and the bot's plain-text screens (app/routers/history.py).

Note: this is deliberately separate from app.keyboards.CAT_RU, which uses
shorter wording plus emoji for bot menu buttons (e.g. "Мульты 🎥" instead of
"Мультфильмы") — that's a distinct short-label variant, not a duplicate of
these, so it isn't derived from here.
"""
from __future__ import annotations

CATEGORY_LABELS: dict[str, str] = {
    "movies": "Фильмы",
    "cartoons": "Мультфильмы",
    "series": "Сериалы",
    "dc": "DC",
    "marvel": "Marvel",
}
