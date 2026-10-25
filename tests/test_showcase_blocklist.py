"""Titles TMDb files under Marvel/DC studios that don't belong on the showcase."""
from __future__ import annotations

import pytest

from app.web.server.routes.showcase import _is_showcase_junk


@pytest.mark.parametrize(
    "item",
    [
        {"title": "Hot Wheels Let’s Race: Attack of the T-Rex", "original_title": ""},
        {"title": "Хот Вилс", "original_title": "Hot Wheels Let's Race: Attack of the T-Rex"},
        {"title": "LEGO Marvel Avengers: Code Red", "original_title": ""},
    ],
)
def test_junk_is_filtered(item):
    assert _is_showcase_junk(item)


@pytest.mark.parametrize(
    "item",
    [
        {"title": "Black Panther 3", "original_title": "Black Panther 3"},
        {"title": "Призрачный гонщик", "original_title": "Ghost Rider"},
    ],
)
def test_real_marvel_titles_are_kept(item):
    assert not _is_showcase_junk(item)
