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


def pick_title_weighted(items: list[str], last: str | None) -> str:
    """Same no-immediate-repeat rule as pick_title(), but earlier entries in
    `items` get proportionally higher odds: weight = rank from the end of
    the list, so the first title is `len(items)` times likelier to be
    picked than the last one."""
    n = len(items)
    ranked = list(zip(items, range(n, 0, -1)))
    candidates = [(t, w) for t, w in ranked if t != last] or ranked
    titles, weights = zip(*candidates)
    return random.choices(titles, weights=weights, k=1)[0]


def title_weights(items: list[str]) -> dict[str, int]:
    """Same rank weighting pick_title_weighted() uses, exposed separately so
    callers (e.g. wheel-segment sizing) can size things by weight without
    re-picking a winner."""
    n = len(items)
    return {title: n - i for i, title in enumerate(items)}
