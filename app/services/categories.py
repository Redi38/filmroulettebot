"""Canonical Russian category labels, shared by the web frontend
(app/web/server/) and the bot's plain-text screens (app/routers/history.py).

CATEGORY_SHORT_LABELS holds the compact wording used on buttons/menus (e.g.
"Мульты" instead of "Мультфильмы"). app.keyboards.CAT_RU derives from it by
appending emoji for the bot's Telegram keyboard, and app/web/static/js/core/menu.js
gets the same short text over /api/categories instead of hardcoding its own
copy — so there is exactly one place that spells these words.
"""
from __future__ import annotations

CATEGORY_LABELS: dict[str, str] = {
    "movies": "Фильмы",
    "cartoons": "Мультфильмы",
    "series": "Сериалы",
    "dc": "DC",
    "marvel": "Marvel",
}

CATEGORY_SHORT_LABELS: dict[str, str] = {
    "movies": "Фильмы",
    "cartoons": "Мульты",
    "series": "Сериалы",
    "dc": "DC",
    "marvel": "Marvel",
}

