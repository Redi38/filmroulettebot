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

from .constants import SPIN_COOLDOWN, WHEEL_POOL_SIZE

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
