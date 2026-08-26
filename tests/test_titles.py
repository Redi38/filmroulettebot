"""Unit tests for app/services/titles.py — pure logic, no I/O."""
from __future__ import annotations

import random

from app.services.titles import (
    next_sequel_title,
    pick_title,
    pick_title_weighted,
    title_weights,
)


def test_next_sequel_title_appends_2_when_no_trailing_number():
    assert next_sequel_title("Матрица") == "Матрица 2"


def test_next_sequel_title_increments_existing_trailing_number():
    assert next_sequel_title("Матрица 2") == "Матрица 3"
    assert next_sequel_title("Побег из Шоушенка 9") == "Побег из Шоушенка 10"


def test_pick_title_avoids_immediate_repeat_when_alternative_exists():
    items = ["A", "B"]
    for seed in range(20):
        random.seed(seed)
        assert pick_title(items, "A") == "B"


def test_pick_title_falls_back_to_full_list_when_last_is_only_option():
    # No alternative to "A" exists, so pick_title must not raise / must
    # still return something from the list rather than an empty choice.
    assert pick_title(["A"], "A") == "A"


def test_pick_title_with_no_previous_pick_returns_from_items():
    items = ["A", "B", "C"]
    for seed in range(20):
        random.seed(seed)
        assert pick_title(items, None) in items


def test_pick_title_weighted_avoids_immediate_repeat():
    items = ["A", "B", "C"]
    for seed in range(20):
        random.seed(seed)
        assert pick_title_weighted(items, "A") != "A"


def test_pick_title_weighted_favors_earlier_entries():
    random.seed(42)
    items = ["A", "B", "C", "D", "E"]
    counts = {t: 0 for t in items}
    for _ in range(3000):
        counts[pick_title_weighted(items, None)] += 1
    # Earlier entries carry more weight (rank from the end), so their
    # observed frequency should be strictly decreasing.
    assert counts["A"] > counts["B"] > counts["C"] > counts["D"] > counts["E"]


def test_title_weights_ranks_from_the_end_of_the_list():
    assert title_weights(["A", "B", "C"]) == {"A": 3, "B": 2, "C": 1}


def test_title_weights_single_item():
    assert title_weights(["only"]) == {"only": 1}
