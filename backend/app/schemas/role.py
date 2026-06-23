from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class RoleIn(BaseModel):
    id: str
    name: str = Field(..., min_length=1)
    avatar: str | None = None
    description: str | None = None
    default_engine: str = "edge_tts"
    default_voice: str | None = None
    default_engine_params: dict[str, Any] = Field(default_factory=dict)
    favorite_styles: list[dict[str, Any]] = Field(default_factory=list)


class RoleUpdate(BaseModel):
    name: str | None = None
    avatar: str | None = None
    description: str | None = None
    default_engine: str | None = None
    default_voice: str | None = None
    default_engine_params: dict[str, Any] | None = None
    favorite_styles: list[dict[str, Any]] | None = None


class RoleOut(RoleIn):
    created_at: str
    updated_at: str
