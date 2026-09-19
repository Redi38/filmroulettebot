"""Static configuration constants used across the web route modules."""
from __future__ import annotations

from pathlib import Path

from app.services.categories import CATEGORY_LABELS, CATEGORY_SHORT_LABELS

LIST_PAGE_SIZE = 30
THEATERS_PAGE_SIZE = 10
NOW_PLAYING_MAX_AGE_DAYS = 90

CATEGORIES = CATEGORY_LABELS
CATEGORY_SHORT = CATEGORY_SHORT_LABELS
ROULETTE_CATEGORIES = ("movies", "cartoons", "series")

WEB_USER_ID = 0

STATIC_DIR = Path(__file__).parent.parent.parent / "static"

SPIN_COOLDOWN = 1.5  # seconds
WHEEL_POOL_SIZE = 120  # safety cap on wheel segments (perf/readability), winner included
# The "Рандом" wheel shows every title of every roulette list at once, so it
# needs more headroom than a single list's wheel; still capped so a runaway
# library can't produce an unrenderable disc.
RANDOM_WHEEL_POOL_SIZE = 400
FEATURED_CACHE_TTL = 600  # 10 min
