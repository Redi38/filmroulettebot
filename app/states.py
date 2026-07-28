"""FSM states for the roulette bot."""
from __future__ import annotations

from aiogram.fsm.state import State, StatesGroup


class AddItemStates(StatesGroup):
    """Adding a new title into a roulette category (movies/cartoons/series/dc/marvel)."""
    waiting_title = State()


class UpcomingStates(StatesGroup):
    """Adding a new title into the 'upcoming movies' list."""
    waiting_title = State()
