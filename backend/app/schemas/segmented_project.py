"""Pydantic request/response schemas for the segmented project API."""
from __future__ import annotations

from typing import Any
from pydantic import BaseModel, Field, field_validator


class SegmentIn(BaseModel):
    id: str
    position: int | None = None
    text: str = ""
    ssml: str | None = None
    emotion: str | None = None
    params: dict[str, Any] = Field(default_factory=dict)
    locked_params: list[str] = Field(default_factory=list)
    generated_params: dict[str, Any] | None = None
    current_audio_path: str | None = None
    previous_audio_path: str | None = None
    audio_format: str = "mp3"
    duration_sec: float | None = None
    audio_missing: bool = False
    generated_at: str | None = None
    ssml_annotated_by_llm: bool = False
    created_at: str | None = None
    updated_at: str | None = None


class ChapterIn(BaseModel):
    id: str
    position: int | None = None
    name: str
    engine: str | None = None
    default_params: dict[str, Any] = Field(default_factory=dict)
    split_config: dict[str, Any] = Field(default_factory=dict)
    original_text: str | None = None
    created_at: str | None = None
    updated_at: str | None = None
    segments: list[SegmentIn] = Field(default_factory=list)
    # Frontend chapter-level settings — persisted into default_params by the service layer
    voice_id: str | None = None
    edge_voice: str | None = None
    edge_rate: int | None = None
    edge_volume: int | None = None
    mimo_mode: str | None = None
    mimo_preset_voice: str | None = None
    mimo_instruction: str | None = None
    mimo_clone_voice_id: str | None = None
    language: str | None = None
    speed: float | None = None
    volume: int | None = None
    pitch: float | None = None
    panel_open: bool | None = None


class ProjectIn(BaseModel):
    id: str
    name: str
    schema_version: int = 2
    layout: str = "vertical"
    active_chapter_id: str | None = None
    original_text: str | None = None
    created_at: str | None = None
    updated_at: str | None = None
    chapters: list[ChapterIn] = Field(default_factory=list)

    @field_validator("schema_version")
    @classmethod
    def _only_v2(cls, v: int) -> int:
        if v != 2:
            raise ValueError("Only schema_version=2 is supported")
        return v


class ProjectSummary(BaseModel):
    id: str
    name: str
    schema_version: int
    layout: str
    active_chapter_id: str | None
    created_at: str
    updated_at: str


class ProjectDetail(ProjectIn):
    pass


class SynthesizeSegmentRequest(BaseModel):
    params: dict[str, Any] | None = None
    text: str | None = None
    ssml: str | None = None
    keep_previous: bool = True


class SplitRequest(BaseModel):
    text: str
    mode: str = "rule"  # rule | llm
    delimiters: list[str] | None = None
    replace_strategy: str = "preview_only"  # preview_only | replace_chapter_segments
    after_segment_id: str | None = None


class SplitItem(BaseModel):
    id: str | None = None
    text: str
    emotion: str | None = None
    position: int | None = None
    params: dict[str, Any] = Field(default_factory=dict)
    locked_params: list[str] = Field(default_factory=list)


class SplitResponse(BaseModel):
    items: list[SplitItem]
    project: ProjectDetail | None = None


class MigrateAudioItem(BaseModel):
    project_id: str
    chapter_id: str
    segment_id: str
    data_base64: str


class MigrateRequest(BaseModel):
    projects: list["ProjectIn"]
    audios: list[MigrateAudioItem] = Field(default_factory=list)


class MigrateResultItem(BaseModel):
    project_id: str
    status: str  # ok | error
    message: str | None = None
    audio_uploaded: int = 0
    audio_failed: int = 0


class MigrateResponse(BaseModel):
    results: list[MigrateResultItem]
