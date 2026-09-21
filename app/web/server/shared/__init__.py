"""Shared state, constants, Pydantic bodies, and small helpers used by the
route modules. Import from the submodule that owns the name:

  - constants.py    static config values
  - bodies.py       Pydantic request bodies
  - spin_state.py   bounded in-memory spin cooldown / last-title state, wheel pools
  - validation.py   category / add / rename validation helpers
  - posters.py      cache-only poster lookups and background backfill
  - card.py         card payload assembly
  - assets.py       index.html asset versioning
"""
