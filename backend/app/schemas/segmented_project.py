"""Pydantic request/response schemas for the segmented project API."""
from __future__ import annotations

from typing import Any
from pydantic import BaseModel, Field, field_validator

from app.schemas.common import ItemsOut, validate_base64_field


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
    text_transforms: dict[str, Any] | None = None
    generated_at: str | None = None
    animation_spec: dict[str, Any] | None = None
    created_at: str | None = None
    updated_at: str | None = None


class ChapterIn(BaseModel):
    id: str
    position: int | None = None
    name: str
    voice: dict[str, Any] = Field(default_factory=dict)
    split_config: dict[str, Any] = Field(default_factory=dict)
    original_text: str | None = None
    narration_script: str | None = None
    design_title: str | None = None
    audio_adjust: dict[str, Any] | None = None
    created_at: str | None = None
    updated_at: str | None = None
    segments: list[SegmentIn] = Field(default_factory=list)


class StalePayloadError(Exception):
    """整量保存乐观锁拒绝：payload 的 base_updated_at 与服务端当前 updated_at 不符。

    ``server_updated_at`` 携带服务端当前值，供 409 响应回传客户端做恢复。
    """

    def __init__(self, server_updated_at: str | None):
        super().__init__("stale_payload")
        self.server_updated_at = server_updated_at


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
    narration_script: str | None = None
    default_narrator_role_id: str | None = None
    logo: str | None = None
    configs: dict[str, Any] | None = None
    created_at: str | None = None
    updated_at: str | None = None
    # 乐观锁：本 payload 所基于的服务端 updated_at；None = 不校验（老客户端/agent）
    base_updated_at: str | None = None
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
    source_document_path: str | None = None
    narration_document_path: str | None = None


class SynthesizeSegmentRequest(BaseModel):
    params: dict[str, Any] | None = None
    text: str | None = None
    ssml: str | None = None
    keep_previous: bool = True
    force: bool = False


class SegmentPatchIn(BaseModel):
    """段级部分更新（PATCH）。tri-state：仅更新请求体中出现的字段
    （model_fields_set），显式 null = 清空，字段缺省 = 不动。
    audio/generated_params/generated_at 为服务端自产字段，不在此接受；
    唯一的例外是 unlock_audio=True —— 清除录音 origin 锁（显式解锁意图），
    不触碰音频路径本身。
    """
    text: str | None = None
    emotion: str | None = None
    role_id: str | None = None
    segment_kind: str | None = None
    voice: dict[str, Any] | None = None
    unlock_audio: bool | None = None
    # 段级文本变换（小写化覆盖 / 发音映射段级引用）。整字典替换（含显式 null 键）：
    # 跟随项目 = 该键为 null，tri-state 语义由后端「字段缺省=不动、显式 null=清空」保证。
    text_transforms: dict[str, Any] | None = None


class SegmentPatchOut(BaseModel):
    """PATCH 响应：更新后的段 + 服务端项目 updated_at（前端用它推进乐观锁 base）。"""
    segment: SegmentIn
    project_updated_at: str


class SegmentCreateIn(BaseModel):
    """新建段请求（POST .../segments）。

    text 可为空（先建空段再补文本是合法场景）；after_id 指定插入锚点
    （插到该段之后），null/缺省 = 追加到章末。
    """
    text: str = ""
    after_id: str | None = None


class SegmentPositionOut(BaseModel):
    """段 id → 最终 position，结构变更后前端按此收敛本地排序。"""
    id: str
    position: int


class SegmentCreateOut(BaseModel):
    """新建段响应：新段 + 章内全部段的 position 列表 + 项目最新 updated_at。"""
    segment: SegmentIn
    positions: list[SegmentPositionOut]
    project_updated_at: str


class StructureSegmentIn(BaseModel):
    """章节内结构 reconcile 的段项。

    id 缺省/null → 新建段（服务端分配 id）；id 在该章存在 → 更新 text/position
    （audio/generated_params/generated_at 等服务端自产字段不在此接受）；
    id 存在但该章无此行 → 按新建处理（用给定 id 播种，对齐 save_project）。
    """
    id: str | None = None
    text: str = ""
    position: int


class ChapterStructureIn(BaseModel):
    """PATCH .../chapters/{cid}/structure 请求体：目标章段的期望终态。"""
    segments: list[StructureSegmentIn] = Field(default_factory=list)


class ChapterStructureOut(BaseModel):
    """structure reconcile 响应：该章 reconcile 后的全部段（按 position 升序）
    + 项目最新 updated_at。"""
    segments: list[SegmentIn]
    project_updated_at: str


# ----- 章节操作（C 类：章节 CRUD + reorder） -----


class ChapterCreateIn(BaseModel):
    """新建章节请求（POST .../chapters）：position 追加到项目末尾。"""
    name: str


class ChapterPatchIn(BaseModel):
    """章节部分更新（PATCH .../chapters/{cid}）。tri-state：仅更新请求体中
    出现的字段（model_fields_set），显式 null = 清空，字段缺省 = 不动。
    纯字段更新，不触碰段的音频等自产字段。
    """
    name: str | None = None
    voice: dict[str, Any] | None = None
    split_config: dict[str, Any] | None = None
    design_title: str | None = None


class ChapterMutationOut(BaseModel):
    """章节新建/PATCH 响应：更新后的章节 + 项目最新 updated_at
    （后者供前端推进乐观锁 base）。"""
    chapter: ChapterIn
    project_updated_at: str


class ChapterDeleteOut(BaseModel):
    """删章响应：只携带项目最新 updated_at（前端用它推进乐观锁 base）。
    200 带体而非 204——前端需要新 base。"""
    project_updated_at: str


class ChapterReorderIn(BaseModel):
    """章节重排请求（POST .../chapters:reorder）：chapter_ids 必须恰好覆盖
    项目全部章节 id（缺/多/未知 → 422），按数组顺序赋 position 0..n-1。"""
    chapter_ids: list[str] = Field(default_factory=list)


class ChapterReorderItemOut(BaseModel):
    """重排后单章的 {id, name, position} 终态。"""
    id: str
    name: str
    position: int


class ChapterReorderOut(BaseModel):
    """章节重排响应：全章按新序的 {id, name, position} + 项目最新 updated_at。"""
    chapters: list[ChapterReorderItemOut]
    project_updated_at: str


# ----- 项目元信息 + 文档层（D/E 类：粒度重构 Phase 5） -----


class ProjectPatchIn(BaseModel):
    """项目元信息部分更新（PATCH /segmented-projects/{id}）。tri-state：仅更新
    请求体中出现的字段（model_fields_set），显式 null = 清空，字段缺省 = 不动。
    改名时在同一事务内搬迁资产目录并重写存储路径（复用 _relocate_project_assets）。
    """
    name: str | None = None
    layout: str | None = None
    configs: dict[str, Any] | None = None
    default_narrator_role_id: str | None = None
    logo: str | None = None
    remotion_project_path: str | None = None
    animation_theme: str | None = None


class DocumentPutIn(BaseModel):
    """文档层 PUT（source-document / narration-script）请求体。"""
    text: str


class DocumentPutOut(BaseModel):
    """文档层 PUT 响应：文件绝对路径（workers 模式无文件系统 -> None）
    + 项目最新 updated_at（供前端推进乐观锁 base）。"""
    path: str | None
    project_updated_at: str


class SweepOrphanAudioRequest(BaseModel):
    """孤儿音频 sweep 请求：缺省 dry-run（只报告不删）；``execute=true`` 才真正
    删除（粒度重构 Phase 6 的唯一显式文件回收入口，local-only）。"""
    execute: bool = False


class SweepOrphanItem(BaseModel):
    """单个孤儿文件报告项（path 为 segmented_dir 相对路径）。"""
    path: str
    size_bytes: int


class SweepOrphanAudioOut(BaseModel):
    """sweep 响应：孤儿清单 + 汇总；execute=true 时 deleted_count 为实际删除数。"""
    dry_run: bool
    orphans: list[SweepOrphanItem]
    total_count: int
    total_size_bytes: int
    deleted_count: int = 0


class ExportTextFileRequest(BaseModel):
    filename: str
    content: str
    export_directory: str | None = None


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
    _validate = field_validator("data_base64", mode="before")(validate_base64_field)
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
    """单个 segment 的动画规格 (写到 segments.animation_spec_json)

    extra="allow": kv workflow 的 brief 字段 (narration_text / visual_content /
    animation / start_sec ...) 原样透传给 apply_animation_spec 合并.
    """
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

    model_config = {"extra": "allow"}


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


# ── TTS Synthesis Params ──

class SynthesizeParams(BaseModel):
    """Structured TTS parameters for synthesize_with_engine.
    All fields are optional — the engine determines which subset is used."""

    engine: str = "edge_tts"

    # Edge-TTS
    edge_voice: str | None = None
    edge_rate: str | None = None
    edge_volume: str | None = None

    # CosyVoice
    voice_id: str = ""
    instruction: str = ""
    speed: float = 1.0
    volume: int = 80
    pitch: float = 1.0
    language: str = "Chinese"
    enable_ssml: bool = False
    enable_markdown_filter: bool = False

    # MiMo
    mimo_mode: str = "preset"
    mimo_preset_voice: str | None = None
    mimo_clone_voice_id: str | None = None
    mimo_voice_description: str | None = None
    mimo_instruction: str = ""

    # VoxCPM
    voxcpm_mode: str = "tts"
    voxcpm_voice_description: str = ""
    voxcpm_style_control: str = ""
    voxcpm_prompt_text: str | None = None
    voxcpm_cfg_value: float = 2.0
    voxcpm_inference_timesteps: int = 10

    # IndexTTS（sidecar HTTP 调用，情绪走 emo_vector 不走文本 tag）
    indextts_lang: str = "ZH"
    indextts_emo_alpha: float = 1.0
    indextts_duration_factor: float = 1.0

    # Context (MiMo voice design)
    context: list[dict[str, str]] | None = None

    # Style tags
    mute_tags: bool = False

    # 合成前把下划线替换为空格（只影响合成文本，不影响显示/字幕）
    underscore_to_space: bool = False

    # 合成前移除成对括号及其内容（只影响合成文本，不影响显示/字幕）
    skip_parenthesized: bool = False

    # Metadata
    role_id: str | None = None
    segment_kind: str = "narration"
