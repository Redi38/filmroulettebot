"""Domain logic for title selection/naming, shared by the bot
(app/routers/roulette/) and the web frontend (app/web/server/). Neither
interface should re-implement these rules independently.
"""
from __future__ import annotations

import random
import re


def next_sequel_title(item: str) -> str:
    """"Movie 2" -> "Movie 3", "Movie" -> "Movie 2"."""
    m = re.search(r"(.+?)\s(\d+)$", item)
    return f"{m.group(1)} {int(m.group(2)) + 1}" if m else f"{item} 2"


def pick_title(items: list[str], last: str | None) -> str:
    """Pick a random title from `items`, avoiding an immediate repeat of
    `last` when the list has other options to offer."""
    candidates = [i for i in items if i != last] or items
    return random.choice(candidates)
