"""Pydantic request/response schemas for the segmented project API."""
from __future__ import annotations

from typing import Any
from pydantic import BaseModel, Field, field_validator


class SegmentIn(BaseModel):
    id: str
    position: int | None = None
    text: str = ""
    emotion: str | None = None
    role_id: str | None = None
    segment_kind: str = "narration"
    voice: dict[str, Any] = Field(default_factory=lambda: {"source": "chapter"})
    generated_params: dict[str, Any] | None = None
    audio: dict[str, Any] | None = None
    generated_at: str | None = None
    animation_spec: dict[str, Any] | None = None
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
    design_title: str | None = None
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
    animation_theme: str | None = None
    remotion_project_path: str | None = None
    source_document: str | None = None
    default_narrator_role_id: str | None = None
    default_narrator_snapshot: dict[str, Any] | None = None
    configs: dict[str, Any] | None = None
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
    remotion_project_path: str | None = None
    summary_stats: dict[str, int | float] | None = None
    created_at: str
    updated_at: str


class ProjectDetail(ProjectIn):
    pass


class SynthesizeSegmentRequest(BaseModel):
    params: dict[str, Any] | None = None
    text: str | None = None
    ssml: str | None = None
    keep_previous: bool = True


class ExportTextFileRequest(BaseModel):
    filename: str
    content: str


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


# ===== P2 v3: Animation Spec 批量应用 =====

class AnimationSpecItem(BaseModel):
    """单个 segment 的动画规格 (写到 segments.animation_spec_json)"""
    segment_id: str
    visual_concept: str | None = None
    layout: str | None = None
    mood: str | None = None
    phases: dict[str, Any] | None = None
    animations: dict[str, Any] | None = None
    elements: list[dict[str, Any]] | None = None
    emphasis: list[str] | None = None
    asset_refs: list[str] | None = None
    notes: str | None = None


class ApplyAnimationSpecRequest(BaseModel):
    """skill 一次性 POST 全部 spec, 后端原子更新"""
    theme: str | None = None
    segments: list[AnimationSpecItem] = Field(default_factory=list)
    narration_version: str | None = None


class ApplyAnimationSpecResult(BaseModel):
    theme_updated: bool
    segments_updated: int
    segments_skipped: int = 0
    missing_segment_ids: list[str] = Field(default_factory=list)

    model_config = {"from_attributes": True}


class SourceDocumentIn(BaseModel):
    source_type: str  # 'paste' | 'audio' | 'path'
    title: str
    pasted_text: str | None = None
    file_path: str | None = None
    audio_path: str | None = None
    file_size: int | None = None
    duration_sec: float | None = None


class SourceDocumentOut(BaseModel):
    id: str
    project_id: str
    source_type: str
    title: str
    file_path: str | None
    pasted_text: str | None
    audio_path: str | None
    file_size: int | None
    duration_sec: float | None
    created_at: str
    updated_at: str | None = None
