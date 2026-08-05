"""Generic list response envelope (audit A11).

All list endpoints return `{items: [...]}` for consistency. The `items` key is
the single standard key for list data across the entire API.

Usage with typed items::

    @router.get("/voices", response_model=ItemsOut[VoiceProfileOut])
    def list_voices(...):
        return {"items": [voice_to_dict(v) for v in voices]}

Usage with untyped items (rare, e.g. edge-voices which are dicts)::

    @router.get("/edge-voices")
    def list_edge_voices(...):
        return {"items": voices}
"""
from __future__ import annotations

from typing import Generic, TypeVar

from pydantic import BaseModel

T = TypeVar("T")


class ItemsOut(BaseModel, Generic[T]):
    """Standard list envelope. ``items`` is always a list of ``T``."""

    items: list[T]
