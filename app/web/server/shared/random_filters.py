"""Viewer preferences for the "Рандом" wheel: "only films" and a maximum
film length. Both are per-browser choices (kept in localStorage on the
client and sent with every random-wheel request), not household settings —
one person's "under two hours tonight" shouldn't change the wheel for
everyone else, which is what app_settings is for.

The two filters are independent:

- films_only drops the *series list* from the wheel. Cartoons and the
  Marvel/DC lots always stay, whatever they resolve to.
- max_runtime applies to films only. A series has no single runtime, so
  series entries (the series list, a cartoon row flagged is_series, a
  Marvel/DC lot whose first title is a show) are never dropped by it —
  when films_only is off, series stay on the wheel.

Filtering runs after random_entries() and removes entries together with
their weights, so a surviving title keeps the weight its list position gave
it — the weighted wheel doesn't reshuffle its odds when half of it is
filtered away, and /api/random/wheel-weights stays correct unchanged.

Runtime is read cache-only from the movie_info entries card lookups already
store (same rule as posters.py: never block a spin on TMDb). A film whose
runtime isn't cached yet stays on the wheel rather than silently vanishing,
and gets a background lookup so the next spin can filter it properly.
"""
from __future__ import annotations

from dataclasses import dataclass

from app.db.database import get_items_with_ids, get_tmdb_cache_many

from . import posters
from .spin_state import WheelEntry

RUNTIME_CACHE_TTL = 365 * 24 * 3600  # a film's runtime doesn't go stale
RUNTIME_BACKFILL_PER_CALL = 8  # same trickle rate as the wheel poster backfill

_MOVIE_INFO = "movie_info"
# Category whose rows can be either a film or a show (per-row is_series flag).
_MIXED_CATEGORY = "cartoons"


@dataclass(frozen=True)
class RandomFilters:
    films_only: bool = False
    max_runtime: int | None = None  # minutes; None = any length

    @property
    def active(self) -> bool:
        return self.films_only or self.max_runtime is not None


def _cache_key(title: str) -> str:
    # Must match posters._cache_key / media_info's key for movie_info.
    return f"{_MOVIE_INFO}:{title.strip().lower()}"


def _runtime(info: object) -> int | None:
    """Runtime in minutes from a cached info card, or None when unknown
    (missing entry, or TMDb's "—" placeholder)."""
    if not isinstance(info, dict):
        return None
    value = info.get("runtime")
    return value if isinstance(value, int) and value > 0 else None


async def _series_cartoons() -> set[str]:
    rows = await get_items_with_ids(_MIXED_CATEGORY)
    return {row["title"] for row in rows if row.get("is_series") is True}


async def apply_random_filters(
    entries: list[WheelEntry],
    weights: list[int],
    filters: RandomFilters,
    lot_is_series: dict[str, bool | None],
) -> tuple[list[WheelEntry], list[int]]:
    """Drop the entries `filters` rules out, keeping weights aligned."""
    if not filters.active:
        return entries, weights

    if filters.films_only:
        kept = [(e, w) for e, w in zip(entries, weights) if e.cat != "series"]
    else:
        kept = list(zip(entries, weights))

    if filters.max_runtime is None:
        return [e for e, _ in kept], [w for _, w in kept]

    series_cartoons = await _series_cartoons()

    def is_film(entry: WheelEntry) -> bool:
        if entry.cat == "series":
            return False
        if entry.cat in lot_is_series:  # a Marvel/DC lot
            return lot_is_series[entry.cat] is not True
        if entry.cat == _MIXED_CATEGORY:
            return entry.title not in series_cartoons
        return True

    films = {e.title for e, _ in kept if is_film(e)}
    cached = await get_tmdb_cache_many([_cache_key(t) for t in films], RUNTIME_CACHE_TTL)

    result: list[tuple[WheelEntry, int]] = []
    backfills = 0
    for entry, weight in kept:
        if not is_film(entry):
            result.append((entry, weight))
            continue
        runtime = _runtime(cached.get(_cache_key(entry.title)))
        if runtime is None:
            # Unknown: keep it, and warm the cache so the next spin knows.
            if _cache_key(entry.title) not in cached and backfills < RUNTIME_BACKFILL_PER_CALL:
                posters.schedule_poster_backfill(entry.cat, entry.title, lot_is_series.get(entry.cat))
                backfills += 1
            result.append((entry, weight))
        elif runtime <= filters.max_runtime:
            result.append((entry, weight))
    return [e for e, _ in result], [w for _, w in result]
