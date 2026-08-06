"""Generic list response envelope (audit A11).

All list endpoints return ``{items: [...]}`` for consistency. The ``items`` key is
the single standard key for list data across the entire API.

Usage with typed items::

    @router.get("/voices", response_model=ItemsOut[VoiceProfileOut])
    def list_voices(...):
        return {"items": [voice_to_dict(v) for v in voices]}

Usage with untyped items (rare, e.g. edge-voices which are dicts)::

    @router.get("/edge-voices")
    def list_edge_voices(...):
        return {"items": voices}

Binary upload convention (audit A13):

- Files > 1 MB should use multipart/form-data.
- Files <= 1 MB may use base64 in JSON, with a 1 MB decoded size limit.
- Synthesis responses return ``audio_base64`` for convenience; no inbound limit.
"""
from __future__ import annotations

import base64
from typing import Generic, TypeVar

from pydantic import BaseModel

T = TypeVar("T")

BASE64_MAX_BYTES = 1 * 1024 * 1024  # 1 MB


def validate_base64_field(v: str, field_name: str = "audio_base64") -> str:
    """Validate that a base64 string decodes to at most BASE64_MAX_BYTES.

    Use as a ``@field_validator`` body::

        _validate_base64 = field_validator("audio_base64", mode="before")(validate_base64_field)
    """
    try:
        decoded = base64.b64decode(v, validate=True)
    except Exception:
        raise ValueError("Invalid base64 encoding")
    if len(decoded) > BASE64_MAX_BYTES:
        raise ValueError(
            f"Decoded size {len(decoded)} bytes exceeds {BASE64_MAX_BYTES} bytes limit. "
            "Use multipart/form-data for larger files."
        )
    return v


class ItemsOut(BaseModel, Generic[T]):
    """Standard list envelope. ``items`` is always a list of ``T``."""

    items: list[T]
