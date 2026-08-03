"""Pydantic response schema for VoiceProfile.

Matches the `voice_to_dict` serialization in `app/api/_voice_helpers.py` so
endpoints returning a voice can declare `response_model=VoiceProfileOut` and
get response validation + a stable contract (audit A5/B-P1-8).

Note: `voice` / `voice_params` / `preview` are free-form JSON (engine-specific
shapes); they are typed as `dict` intentionally. `created_at` is serialized as
an ISO string (not `datetime`) so the wire format is unchanged from the
hand-rolled `voice_to_dict`.
"""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, field_validator


class VoiceProfileOut(BaseModel):
    id: str
    name: str
    description: str | None = None
    avatar: str | None = None
    project_id: str | None = None
    # TODO(B-P1-8 follow-up): `voice` has a known shape ({model, voice_type})
    # and could be a sub-model; `voice_params` is genuinely engine-specific and
    # stays free-form. Left as `dict` for now to match voice_to_dict exactly.
    voice: dict
    voice_params: dict
    preview: dict | None = None
    has_preview: bool
    has_source: bool
    created_at: str | None = None

    model_config = {"from_attributes": True}

    @field_validator("created_at", mode="before")
    @classmethod
    def coerce_created_at(cls, v):
        """Defensive: if an ORM object is ever returned directly (bypassing
        `voice_to_dict`, which already calls `.isoformat()`), coerce the raw
        `datetime` to an ISO string so `str` validation doesn't fail."""
        if v is None or isinstance(v, str):
            return v
        if isinstance(v, datetime):
            return v.isoformat()
        return str(v)
