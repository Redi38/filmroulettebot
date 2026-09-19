"""Unit tests for app/web/server/shared.py — the bounded in-memory state,
category validation, spin cooldown, no-repeat title picking, and wheel-pool
construction. No DB/network involved."""
from __future__ import annotations

import time

import pytest
from fastapi import HTTPException

from app.web.server.shared import (
    CATEGORIES,
    ROULETTE_CATEGORIES,
    SPIN_COOLDOWN,
    _BoundedDict,
    _build_random_wheel_pool,
    _build_wheel_pool,
    _check_category,
    _check_spin_cooldown,
    _last_spin_at,
    _pick_random_entry,
    _pick_title,
    _random_entries,
    _random_pool_weights,
)

# --- _BoundedDict ------------------------------------------------------

def test_bounded_dict_evicts_oldest_entry_beyond_capacity():
    d: _BoundedDict = _BoundedDict(max_entries=3)
    d["a"] = 1
    d["b"] = 2
    d["c"] = 3
    d["d"] = 4  # over capacity -> "a" (oldest) is evicted
    assert list(d.keys()) == ["b", "c", "d"]
    assert "a" not in d


def test_bounded_dict_re_setting_a_key_moves_it_to_the_end():
    d: _BoundedDict = _BoundedDict(max_entries=3)
    d["a"] = 1
    d["b"] = 2
    d["c"] = 3
    d["a"] = 10  # touching "a" again should protect it from eviction
    d["d"] = 4  # "b" is now the oldest, gets evicted instead of "a"
    assert list(d.keys()) == ["c", "a", "d"]
    assert d["a"] == 10


def test_bounded_dict_never_exceeds_max_entries_under_many_inserts():
    d: _BoundedDict = _BoundedDict(max_entries=10)
    for i in range(1000):
        d[f"key-{i}"] = i
    assert len(d) == 10
    # only the most recent 10 keys should have survived
    assert list(d.keys()) == [f"key-{i}" for i in range(990, 1000)]


# --- _check_category -----------------------------------------------------

def test_check_category_rejects_unknown_category():
    with pytest.raises(HTTPException) as exc_info:
        _check_category("definitely-not-a-category")
    assert exc_info.value.status_code == 404


def test_check_category_accepts_every_known_category():
    for cat in CATEGORIES:
        _check_category(cat)  # must not raise


# --- _check_spin_cooldown -------------------------------------------------

def test_spin_cooldown_blocks_immediate_second_spin():
    ip = "1.2.3.4"
    _check_spin_cooldown(ip)  # first spin: fine
    with pytest.raises(HTTPException) as exc_info:
        _check_spin_cooldown(ip)
    assert exc_info.value.status_code == 429


def test_spin_cooldown_is_per_client_ip():
    _check_spin_cooldown("1.1.1.1")
    _check_spin_cooldown("2.2.2.2")  # different client, no cooldown yet


def test_spin_cooldown_allows_spin_again_once_elapsed(monkeypatch):
    ip = "9.9.9.9"
    fake_now = [1000.0]
    monkeypatch.setattr(time, "monotonic", lambda: fake_now[0])

    _check_spin_cooldown(ip)
    fake_now[0] += SPIN_COOLDOWN + 0.01
    _check_spin_cooldown(ip)  # must not raise


def test_spin_cooldown_state_is_bounded(monkeypatch):
    # Regression guard for the unbounded-growth issue: hammering the
    # cooldown check with many distinct client IPs must not grow
    # _last_spin_at past its cap.
    from app.web.server.shared import _SPIN_STATE_MAX_ENTRIES

    fake_now = [0.0]
    monkeypatch.setattr(time, "monotonic", lambda: fake_now[0])
    for i in range(_SPIN_STATE_MAX_ENTRIES + 500):
        fake_now[0] += SPIN_COOLDOWN + 0.01
        _check_spin_cooldown(f"10.0.0.{i}")
    assert len(_last_spin_at) <= _SPIN_STATE_MAX_ENTRIES


# --- _pick_title -----------------------------------------------------------

def test_pick_title_does_not_immediately_repeat():
    items = ["A", "B"]
    first = _pick_title("client-1", "movies", items)
    second = _pick_title("client-1", "movies", items)
    assert first != second


def test_pick_title_is_scoped_per_client_and_category():
    items = ["A", "B", "C"]
    _pick_title("client-1", "movies", items)
    # a different client/category pair has no memory of client-1's pick,
    # so it's free to pick anything (just checking it doesn't error / it
    # returns a valid item).
    assert _pick_title("client-2", "movies", items) in items
    assert _pick_title("client-1", "series", items) in items


# --- _build_wheel_pool -------------------------------------------------

def test_build_wheel_pool_contains_all_items_when_within_size_cap():
    items = ["A", "B", "C"]
    pool, weights = _build_wheel_pool(items, "B")
    assert sorted(pool) == sorted(items)
    assert len(weights) == len(pool)


def test_build_wheel_pool_always_includes_the_winner():
    pool, _ = _build_wheel_pool(["A", "B"], "WINNER-NOT-IN-ITEMS")
    assert "WINNER-NOT-IN-ITEMS" in pool


def test_build_wheel_pool_caps_size_for_large_lists():
    items = [f"title-{i}" for i in range(500)]
    winner = items[0]
    pool, weights = _build_wheel_pool(items, winner, size=120)
    assert len(pool) == 120
    assert len(weights) == 120
    assert winner in pool


def test_build_wheel_pool_unweighted_gives_equal_weights():
    items = ["A", "B", "C"]
    _, weights = _build_wheel_pool(items, "A", weighted=False)
    assert weights == [1] * len(weights)


def test_build_wheel_pool_weighted_gives_earlier_items_more_weight():
    items = ["A", "B", "C"]
    pool, weights = _build_wheel_pool(items, "A", weighted=True)
    weight_by_title = dict(zip(pool, weights))
    assert weight_by_title["A"] == 3
    assert weight_by_title["B"] == 2
    assert weight_by_title["C"] == 1


# --- random / movies wheel (all titles on one wheel, plus Marvel/DC lots) ------

def test_random_entries_flatten_every_list_with_flat_weights():
    entries, weights = _random_entries({"movies": ["A", "B"], "series": ["C"]})
    assert entries == [("movies", "A", "A"), ("movies", "B", "B"), ("series", "C", "C")]
    assert weights == [1, 1, 1]


def test_random_entries_weighted_gives_the_same_position_the_same_weight_in_every_list():
    entries, weights = _random_entries(
        {"movies": ["A", "B", "C", "D"], "cartoons": ["E", "F"], "series": ["G", "H", "I"]}, weighted=True,
    )
    by_entry = {(e.cat, e.title): w for e, w in zip(entries, weights)}
    # Counted from the longest list (4), so position 0 is 4 everywhere, 1 is 3, ...
    assert [by_entry[("movies", t)] for t in "ABCD"] == [4, 3, 2, 1]
    assert [by_entry[("series", t)] for t in "GHI"] == [4, 3, 2]
    assert [by_entry[("cartoons", t)] for t in "EF"] == [4, 3]


def test_random_entries_add_a_lot_per_franchise_labelled_with_its_name():
    entries, weights = _random_entries(
        {"movies": ["A", "B"]}, lots={"marvel": "Железный человек", "dc": "Бэтмен"},
    )
    assert entries[-2:] == [("marvel", "Железный человек", "Marvel"), ("dc", "Бэтмен", "DC")]
    assert weights == [1, 1, 1, 1]


def test_random_entries_weighted_lot_weighs_a_first_position():
    entries, weights = _random_entries({"movies": ["A", "B", "C"]}, weighted=True, lots={"marvel": "X"})
    assert dict(zip([e.label for e in entries], weights)) == {"A": 3, "B": 2, "C": 1, "Marvel": 3}


def test_random_entries_weighted_lots_alone_still_have_a_positive_weight():
    _, weights = _random_entries({}, weighted=True, lots={"marvel": "X", "dc": "Y"})
    assert weights == [1, 1]


def test_build_random_wheel_pool_holds_every_title_from_every_list():
    entries, weights = _random_entries({"movies": ["A", "B"], "cartoons": ["C"], "series": ["D"]})
    pool, pool_weights, _ = _build_random_wheel_pool(entries, weights, entries[-1])
    assert sorted(pool) == ["A", "B", "C", "D"]
    assert len(pool_weights) == len(pool)


def test_build_random_wheel_pool_keeps_weights_aligned_with_titles():
    entries, weights = _random_entries({"movies": ["A", "B", "C"]}, weighted=True)
    pool, pool_weights, winner_index = _build_random_wheel_pool(entries, weights)
    assert dict(zip(pool, pool_weights)) == {"A": 3, "B": 2, "C": 1}
    assert winner_index is None


def test_build_random_wheel_pool_winner_index_points_at_the_winners_segment():
    entries, weights = _random_entries({"movies": ["A", "B", "C"]}, lots={"marvel": "Железный человек"})
    for winner in entries:
        pool, _, winner_index = _build_random_wheel_pool(entries, weights, winner)
        assert pool[winner_index] == winner.label


def test_build_random_wheel_pool_draws_a_lot_by_franchise_name_not_by_its_title():
    entries, weights = _random_entries({"movies": ["A"]}, lots={"marvel": "Железный человек"})
    pool, _, _ = _build_random_wheel_pool(entries, weights, entries[-1])
    assert "Marvel" in pool
    assert "Железный человек" not in pool


def test_build_random_wheel_pool_caps_size_and_keeps_the_winner():
    titles = [f"t{i}" for i in range(50)]
    entries, weights = _random_entries({"movies": titles})
    pool, pool_weights, winner_index = _build_random_wheel_pool(entries, weights, entries[0], size=10)
    assert len(pool) == len(pool_weights) == 10
    assert pool[winner_index] == "t0"


def test_build_random_wheel_pool_without_winner_still_caps_size():
    entries, weights = _random_entries({"movies": [f"t{i}" for i in range(50)]})
    pool, _, _ = _build_random_wheel_pool(entries, weights, None, size=10)
    assert len(pool) == 10


def test_pick_random_entry_returns_an_entry_from_any_list():
    entries, weights = _random_entries({"movies": ["A"], "series": ["B"]}, lots={"dc": "Бэтмен"})
    for client in ("c1", "c2", "c3"):
        assert _pick_random_entry(client, "random", entries, weights) in entries


def test_pick_random_entry_can_land_on_a_lot():
    entries, weights = _random_entries({"movies": ["A"]}, lots={"marvel": "Железный человек"})
    picked = {_pick_random_entry(f"c{i}", "random", entries, weights).cat for i in range(60)}
    assert picked == {"movies", "marvel"}


def test_pick_random_entry_does_not_repeat_the_previous_title():
    entries, weights = _random_entries({"movies": ["A", "B"]})
    first = _pick_random_entry("repeat-client", "random", entries, weights)
    for _ in range(20):
        nxt = _pick_random_entry("repeat-client", "random", entries, weights)
        assert nxt != first
        first = nxt


def test_pick_random_entry_with_a_single_entry_may_repeat():
    entries, weights = _random_entries({"movies": ["Only"]})
    assert _pick_random_entry("solo", "movies", entries, weights).title == "Only"
    assert _pick_random_entry("solo", "movies", entries, weights).title == "Only"


def test_random_pool_weights_normal_mode_is_flat():
    assert _random_pool_weights({"movies": ["A", "B"]}, ["B", "A"]) == [1, 1]


def test_random_pool_weights_weighted_follows_the_pool_order():
    weights = _random_pool_weights({"movies": ["A", "B", "C"]}, ["C", "A", "B"], weighted=True)
    assert weights == [1, 3, 2]


def test_random_pool_weights_weighted_matches_random_entries_across_lists():
    lists = {"movies": ["A", "B", "C"], "series": ["D", "E"]}
    lots = {"marvel": "X"}
    entries, weights = _random_entries(lists, weighted=True, lots=lots)
    pool = [e.label for e in entries]
    assert _random_pool_weights(lists, pool, weighted=True, lots=lots) == weights


def test_roulette_categories_are_a_subset_of_all_categories():
    assert set(ROULETTE_CATEGORIES) <= set(CATEGORIES)
