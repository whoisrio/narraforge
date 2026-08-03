"""Pydantic response schemas for TTS endpoints (audit B-P1-8).

`TTSResultOut` is the contract for every synthesize endpoint (tts / mimo_tts /
voxcpm). All synthesize paths return `audio_id` + `text` + `params` plus a
varying subset of optional fields (frontend-mode returns `audio_base64`,
backend-mode returns `audio_url`; voxcpm adds a top-level `engine`). The
`params` dict is engine-specific and intentionally free-form.

`TTSResultRecordOut` is the persisted-history item shape (`_result_to_dict`).
"""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class TTSResultOut(BaseModel):
    audio_id: str
    text: str
    params: dict[str, Any]
    audio_base64: str | None = None
    audio_url: str | None = None
    audio_format: str | None = None
    voice_id: str | None = None
    voice_name: str | None = None
    engine: str | None = None


class TTSResultRecordOut(BaseModel):
    id: str
    text: str
    voice_id: str
    voice_name: str
    audio_url: str
    audio_format: str
    speed: float
    volume: float
    pitch: float
    instruction: str | None = None
    language: str | None = None
    created_at: str | None = None


class TTSHistoryOut(BaseModel):
    results: list[TTSResultRecordOut]
