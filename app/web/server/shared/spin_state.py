"""In-memory per-client spin state: cooldown timestamps and last-picked
titles, plus the bounded dict they're stored in so long-running processes
can't grow this state without bound."""
from __future__ import annotations

import random
import time
from collections import OrderedDict
from typing import Hashable, TypeVar

from fastapi import HTTPException, Request

from app.config import settings
from app.services.titles import pick_title, pick_title_weighted, title_weights

from .constants import RANDOM_WHEEL_POOL_SIZE, SPIN_COOLDOWN, WHEEL_POOL_SIZE

_SPIN_STATE_MAX_ENTRIES = 5000

_KT = TypeVar("_KT", bound=Hashable)
_VT = TypeVar("_VT")


class _BoundedDict(OrderedDict[_KT, _VT]):
    """OrderedDict that evicts the oldest entry once it exceeds max_entries.
    Used instead of a plain dict for per-client in-memory state so it can't
    grow without bound over the lifetime of a long-running process."""

    def __init__(self, max_entries: int = _SPIN_STATE_MAX_ENTRIES) -> None:
        super().__init__()
        self._max_entries = max_entries

    def __setitem__(self, key: _KT, value: _VT) -> None:
        super().__setitem__(key, value)
        self.move_to_end(key)
        while len(self) > self._max_entries:
            self.popitem(last=False)


_last_spin_at: _BoundedDict[str, float] = _BoundedDict()
_last_spin_title: _BoundedDict[tuple[str, str], str] = _BoundedDict()


def check_spin_cooldown(client_ip: str) -> None:
    now = time.monotonic()
    elapsed = now - _last_spin_at.get(client_ip, 0.0)
    if elapsed < SPIN_COOLDOWN:
        wait = SPIN_COOLDOWN - elapsed
        raise HTTPException(429, f"Подожди {wait:.1f} сек. перед следующим роллом.")
    _last_spin_at[client_ip] = now


def client_ip(request: Request) -> str:
    """Best-effort per-client identifier used for the spin cooldown.

    Only trusts X-Forwarded-For / X-Real-IP when TRUST_PROXY_HEADERS is
    enabled (i.e. the app is known to sit behind nginx/Caddy which sets
    these headers itself). Without a trusted proxy in front, a client could
    otherwise spoof these headers to dodge or grief the cooldown, so we fall
    back to the raw socket address in that case.
    """
    if settings.TRUST_PROXY_HEADERS:
        forwarded_for = request.headers.get("x-forwarded-for")
        if forwarded_for:
            client_ip_value = forwarded_for.split(",")[0].strip()
            if client_ip_value:
                return client_ip_value
        real_ip = request.headers.get("x-real-ip")
        if real_ip:
            return real_ip.strip()
    return request.client.host if request.client else "unknown"


def pick_title_for_client(client_key: str, cat: str, items: list[str], weighted: bool = False) -> str:
    last = _last_spin_title.get((client_key, cat))
    title = pick_title_weighted(items, last) if weighted else pick_title(items, last)
    _last_spin_title[(client_key, cat)] = title
    return title


def build_wheel_pool(
    items: list[str], winner: str, weighted: bool = False, size: int = WHEEL_POOL_SIZE
) -> tuple[list[str], list[int]]:
    """Build the list of titles (and their relative weights) shown as wheel
    segments for the front-end's roulette-wheel spin animation. Shows the
    *entire* roulette (all titles, winner included) as long as it fits under
    the safety cap; only samples down when the list is unusually large.
    Keeps the winner's exact position hidden from the client until it
    computes the index itself.

    Weights use the same rank rule as pick_title_weighted() (earlier entries
    in the *original* `items` order count for more), so a weighted wheel's
    segment sizes accurately reflect the odds that produced the winner. In
    non-weighted mode every segment gets equal weight, same as before this
    was added.
    """
    if len(items) <= size:
        pool = list(items)
        if winner not in pool:
            pool.append(winner)
    else:
        others = [i for i in items if i != winner]
        random.shuffle(others)
        pool = others[: max(size - 1, 0)] + [winner]
    random.shuffle(pool)

    if weighted:
        weight_map = title_weights(items)
        weights = [weight_map.get(t, 1) for t in pool]
    else:
        weights = [1] * len(pool)
    return pool, weights


def pool_weights(items: list[str], pool: list[str], weighted: bool = False) -> list[int]:
    """Recompute wheel-segment weights for an *already-shown* `pool`, in its
    existing order, without resampling or reshuffling it.

    Used when the client toggles weighted/normal mode on an idle wheel: the
    segments already on screen should smoothly resize in place rather than
    the wheel rebuilding with a freshly (and differently) shuffled pool."""
    if not weighted:
        return [1] * len(pool)
    weight_map = title_weights(items)
    return [weight_map.get(t, 1) for t in pool]


# --- "Рандом": one wheel over every roulette list -----------------------------
#
# The random roulette used to be two-stage (spin a wheel of categories, then a
# wheel of that category's titles). It is now a single wheel holding the titles
# of all roulette lists, so a pick is made across the combined list instead of
# category-first. An "entry" is a (category, title) pair: the same title can sit
# in two lists, and the card for the winner has to come from the list it was
# actually drawn from.

_RANDOM_LAST_KEY = "*random*"

Entry = tuple[str, str]


def random_weight(index: int, longest: int) -> int:
    """Weight of the title at `index` (0-based) in weighted mode. Counted from
    the longest roulette list, not from the title's own list, so the same
    position carries the same odds in every list: the first movie, the first
    series and the first cartoon are equally likely, as are all the seconds,
    and so on. Always >= 1, since no list is longer than `longest`."""
    return longest - index


def random_entries(items_by_cat: dict[str, list[str]], weighted: bool = False) -> tuple[list[Entry], list[int]]:
    """Flatten per-category lists into (category, title) entries plus a weight
    per entry. Weighted mode ranks by position (see random_weight()); normal
    mode is a flat 1 per entry, so every title on the wheel is equally likely."""
    longest = max((len(items) for items in items_by_cat.values()), default=0)
    entries: list[Entry] = []
    weights: list[int] = []
    for cat, items in items_by_cat.items():
        for i, title in enumerate(items):
            entries.append((cat, title))
            weights.append(random_weight(i, longest) if weighted else 1)
    return entries, weights


def pick_random_entry(client_key: str, entries: list[Entry], weights: list[int]) -> Entry:
    """Pick the winner across all lists. Same no-immediate-repeat rule as the
    per-list pickers, but remembered under one shared per-client key."""
    last = _last_spin_title.get((client_key, _RANDOM_LAST_KEY))
    idxs = [i for i, (_, title) in enumerate(entries) if title != last] or list(range(len(entries)))
    chosen = random.choices(idxs, weights=[weights[i] for i in idxs], k=1)[0]
    _last_spin_title[(client_key, _RANDOM_LAST_KEY)] = entries[chosen][1]
    return entries[chosen]


def build_random_wheel_pool(
    entries: list[Entry],
    weights: list[int],
    winner: Entry | None = None,
    size: int = RANDOM_WHEEL_POOL_SIZE,
) -> tuple[list[str], list[int]]:
    """Titles (and matching weights) for the combined wheel. Every entry is a
    segment, winner included, unless the library exceeds `size`, in which case
    it is sampled down with the winner guaranteed to stay. `winner` is None for
    the idle preview, where nothing has been picked yet."""
    idxs = list(range(len(entries)))
    if len(idxs) > size:
        win_idx = entries.index(winner) if winner in entries else None
        others = [i for i in idxs if i != win_idx]
        random.shuffle(others)
        idxs = others[: size - (1 if win_idx is not None else 0)]
        if win_idx is not None:
            idxs.append(win_idx)
    random.shuffle(idxs)
    return [entries[i][1] for i in idxs], [weights[i] for i in idxs]


def random_pool_weights(items_by_cat: dict[str, list[str]], pool: list[str], weighted: bool = False) -> list[int]:
    """Recompute segment weights for an already-shown combined `pool` (see
    pool_weights() for why the order must not change). A title that exists in
    more than one list gets its best rank, since the pool alone can't say which
    list a segment came from."""
    if not weighted:
        return [1] * len(pool)
    longest = max((len(items) for items in items_by_cat.values()), default=0)
    best: dict[str, int] = {}
    for items in items_by_cat.values():
        for i, title in enumerate(items):
            best[title] = max(best.get(title, 0), random_weight(i, longest))
    return [best.get(t, 1) for t in pool]
