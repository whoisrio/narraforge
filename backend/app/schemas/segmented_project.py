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
    # P2 v3: 完整动画规格 JSON (visual_concept / layout / phases / animations / emphasis / asset_refs / notes ...)
    animation_spec: dict[str, Any] | None = None
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
    design_title: str | None = None
    # P2 v2: 旁白文档关联 (可选, 旧数据为 None)
    narration_document_id: str | None = None
    narration_version: str | None = None
    narration_slice_start: int | None = None
    narration_slice_end: int | None = None
    narration_synced_at: str | None = None
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
    # P2 v2: 旁白文档 (项目当前活跃版本, e.g. 'v2.1')
    active_narration_version: str | None = None
    # P2 v3: 整体动画主题 (e.g. 'dark-botanical', 'tech-blueprint', 'warm-paper')
    animation_theme: str | None = None
    remotion_project_path: str | None = None
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


# ===== P2 v2: Source & Narration schemas =====

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


class ChapterSlice(BaseModel):
    chapter_index: int
    title: str
    start_char: int
    end_char: int


class NarrationSettings(BaseModel):
    target_chapters: int = 3
    target_words: str = "1000-1500 字"
    language: str = "zh-CN"
    engine: str = "mimo"
    version: str | None = None    # P2 v3+: skill 可显式指定版本号 (否则后端自动 v1, v2, ...)


class GenerateNarrationRequest(BaseModel):
    """Skill 推送旁白文档入口 (P2 v2 概念 + v3 实战).

    Skill 已经 LLM 生成完 body_markdown, 也已经解析出 chapter_slices.
    后端只负责: 算版本号, 写库, 回填 chapter.narration_* 字段.
    """
    body_markdown: str = Field(..., min_length=1, description="完整 markdown 旁白文档")
    source_ids: list[str] = Field(default_factory=list)
    chapter_slices: list[ChapterSlice] = Field(default_factory=list, description="skill 解析的章节切片, 缺则后端按 ## 解析")
    prompt_hint: str | None = None
    settings: NarrationSettings = Field(default_factory=NarrationSettings)


class RegenerateChapterRequest(BaseModel):
    chapter_index: int
    prompt_hint: str | None = None


class NarrationDocumentOut(BaseModel):
    id: str
    project_id: str
    version: str
    version_kind: str
    body_markdown: str
    word_count: int
    source_ids: list[str]
    prompt_hint: str | None
    settings: dict[str, Any]
    chapter_slices: list[ChapterSlice]
    generated_at: str


class NarrationListItem(BaseModel):
    """轻量级, 不含 body_markdown"""
    id: str
    version: str
    version_kind: str
    word_count: int
    source_ids: list[str]
    generated_at: str


# ===== P2 v3: Animation Spec 批量应用 =====

class AnimationSpecItem(BaseModel):
    """单个 segment 的动画规格 (写到 segments.animation_spec_json)"""
    segment_id: str
    # 字段可选, 后端只做 merge: 存在则覆盖, 不存在则保留
    visual_concept: str | None = None
    layout: str | None = None
    mood: str | None = None
    phases: dict[str, Any] | None = None          # {intro_sec, sustain_sec, outro_sec}
    animations: dict[str, Any] | None = None       # {in, sustain, out}
    elements: list[dict[str, Any]] | None = None
    emphasis: list[str] | None = None
    asset_refs: list[str] | None = None
    notes: str | None = None


class ApplyAnimationSpecRequest(BaseModel):
    """skill 一次性 POST 全部 spec, 后端原子更新"""
    theme: str | None = None                        # 同步设置 project.animation_theme (None = 不动)
    segments: list[AnimationSpecItem] = Field(default_factory=list)  # 默认空, 允许只改 theme
    narration_version: str | None = None            # 记录在 spec.generated_at 元信息 (仅 info)


class ApplyAnimationSpecResult(BaseModel):
    theme_updated: bool
    segments_updated: int
    segments_skipped: int = 0                       # segment_id 在项目里找不到
    missing_segment_ids: list[str] = Field(default_factory=list)
