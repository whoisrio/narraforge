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

from pydantic import BaseModel


class VoiceProfileOut(BaseModel):
    id: str
    name: str
    description: str | None = None
    avatar: str | None = None
    project_id: str | None = None
    voice: dict
    voice_params: dict
    preview: dict | None = None
    has_preview: bool
    has_source: bool
    created_at: str | None = None

    model_config = {"from_attributes": True}
