"""Pydantic request bodies shared across route modules."""
from __future__ import annotations

from pydantic import BaseModel


class TitleBody(BaseModel):
    title: str
    tmdb_id: int | None = None
    is_series: bool | None = None


class RenameBody(BaseModel):
    old_title: str
    new_title: str


class DeleteByIdBody(BaseModel):
    id: int


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


class SpinBody(BaseModel):
    weighted: bool = False


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
