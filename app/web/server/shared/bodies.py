"""Pydantic request bodies shared across route modules."""
from __future__ import annotations

from pydantic import BaseModel, Field

# Upper bound on the "Рандом" wheel's max film length (minutes) — anything
# past this is a typo, not a preference.
MAX_RUNTIME_LIMIT = 600


class TitleBody(BaseModel):
    title: str
    tmdb_id: int | None = None
    is_series: bool | None = None


class RenameBody(BaseModel):
    old_title: str
    new_title: str


class DeleteByIdBody(BaseModel):
    id: int


class ReorderBody(BaseModel):
    id: int
    direction: str


class RenameByIdBody(BaseModel):
    id: int
    new_title: str
    tmdb_id: int | None = None
    is_series: bool | None = None


class MoveBody(BaseModel):
    title: str
    category: str


class SequelBody(BaseModel):
    title: str


class SequelResponse(BaseModel):
    """Body of POST /api/{cat}/sequel — declared so OpenAPI (and the
    frontend's generated api.d.ts) know `new_title` is a string."""

    ok: bool = True
    new_title: str


class SpinBody(BaseModel):
    weighted: bool = False
    # "Рандом" wheel preferences (see shared/random_filters.py); ignored by
    # the per-category spin.
    films_only: bool = False
    max_runtime: int | None = Field(default=None, ge=1, le=MAX_RUNTIME_LIMIT)


class WheelWeightsBody(BaseModel):
    pool: list[str]
    weighted: bool = False


class SkipBody(BaseModel):
    scope: str
    title: str


class SettingBody(BaseModel):
    value: bool


class ResolveBody(BaseModel):
    category: str
    title: str
    timestamp: float
    resolved_type: str
    new_title: str | None = None


class DeleteHistoryEntryBody(BaseModel):
    category: str
    title: str
    timestamp: float
