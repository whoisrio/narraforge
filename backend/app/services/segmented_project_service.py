"""Business logic for segmented project CRUD and asset mirroring."""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from app.core import segmented_assets as assets
from app.core.audio_encoder import (
    AudioEncoderError,
    is_ffmpeg_available,
    probe_audio_duration,
    transcode_to_mp3,
)
from app.models.segmented_project import (
    SegmentedProject,
    SegmentedProjectChapter,
    SegmentedProjectSegment,
)
from app.schemas.segmented_project import (
    ChapterIn,
    ProjectDetail,
    ProjectIn,
    ProjectSummary,
    SegmentIn,
)

logger = logging.getLogger(__name__)


# ----- helpers -----

def _to_iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.isoformat()
    return value.astimezone(timezone.utc).isoformat()


def _parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    if value.endswith("Z"):
        value = value[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(value)
    except ValueError:
        return None
    if dt.tzinfo is not None:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


def _parse_animation_spec(raw: str | None) -> dict[str, Any] | None:
    """P2 v3: 解析 segments.animation_spec_json 字符串为 dict. None / 解析失败 → None."""
    if not raw:
        return None
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return None


def _dump_animation_spec(spec: dict[str, Any] | None) -> str | None:
    """P2 v3: 序列化 dict 为 JSON 字符串. None → None."""
    if spec is None:
        return None
    return json.dumps(spec, ensure_ascii=False)


# ----- serialization -----

def project_to_summary(p: SegmentedProject) -> ProjectSummary:
    return ProjectSummary(
        id=p.id,
        name=p.name,
        schema_version=p.schema_version,
        layout=p.layout,
        active_chapter_id=p.active_chapter_id,
        created_at=_to_iso(p.created_at) or "",
        updated_at=_to_iso(p.updated_at) or "",
    )


# Keys stored inside default_params that correspond to frontend chapter-level settings
_CHAPTER_META_KEYS = (
    "voice_id", "edge_voice", "edge_rate", "edge_volume",
    "mimo_mode", "mimo_preset_voice", "mimo_instruction", "mimo_clone_voice_id",
    "language", "speed", "volume", "pitch", "panel_open",
)


def _extract_chapter_meta(default_params: dict[str, Any]) -> dict[str, Any]:
    """Pull frontend chapter-level settings out of default_params into top-level fields."""
    out: dict[str, Any] = {}
    for k in _CHAPTER_META_KEYS:
        if k in default_params:
            out[k] = default_params[k]
    return out


def _merge_chapter_meta_to_params(ch_in: ChapterIn) -> dict[str, Any]:
    """Merge frontend chapter-level fields into default_params for storage."""
    dp = dict(ch_in.default_params or {})
    for k in _CHAPTER_META_KEYS:
        v = getattr(ch_in, k, None)
        if v is not None:
            dp[k] = v
    return dp


def project_to_detail(p: SegmentedProject) -> ProjectDetail:
    chapters = []
    for ch in p.chapters:
        dp = dict(ch.default_params or {})
        meta = _extract_chapter_meta(dp)
        segs = [
            SegmentIn(
                id=s.id, position=s.position, text=s.text, ssml=s.ssml,
                emotion=s.emotion, params=s.params or {},
                locked_params=s.locked_params or [],
                generated_params=s.generated_params,
                current_audio_path=s.current_audio_path,
                previous_audio_path=s.previous_audio_path,
                audio_format=s.audio_format or "mp3",
                duration_sec=s.duration_sec,
                audio_missing=bool(s.audio_missing),
                generated_at=_to_iso(s.generated_at),
                ssml_annotated_by_llm=bool(s.ssml_annotated_by_llm),
                # P2 v3: 解析 JSON 字符串回 dict (None 表示未设置)
                animation_spec=_parse_animation_spec(s.animation_spec_json),
                created_at=_to_iso(s.created_at),
                updated_at=_to_iso(s.updated_at),
            )
            for s in ch.segments
        ]
        chapters.append(
            ChapterIn(
                id=ch.id, position=ch.position, name=ch.name,
                engine=ch.engine,
                default_params=dp,
                split_config=ch.split_config or {},
                original_text=ch.original_text,
                # P2 v2: 旁白文档关联
                narration_document_id=ch.narration_document_id,
                narration_version=ch.narration_version,
                narration_slice_start=ch.narration_slice_start,
                narration_slice_end=ch.narration_slice_end,
                narration_synced_at=_to_iso(ch.narration_synced_at),
                created_at=_to_iso(ch.created_at),
                updated_at=_to_iso(ch.updated_at),
                segments=segs,
                **meta,
            )
        )
    return ProjectDetail(
        id=p.id, name=p.name, schema_version=p.schema_version,
        layout=p.layout, active_chapter_id=p.active_chapter_id,
        original_text=p.original_text,
        # Pyright 误判 Column[] 类型; 实际运行时值是 str | None
        active_narration_version=getattr(p, "active_narration_version", None),
        animation_theme=getattr(p, "animation_theme", None),
        created_at=_to_iso(p.created_at),
        updated_at=_to_iso(p.updated_at),
        chapters=chapters,
    )


# ----- CRUD -----

def list_projects(db: Session) -> list[ProjectSummary]:
    rows = (
        db.query(SegmentedProject)
        .order_by(SegmentedProject.updated_at.desc())
        .all()
    )
    return [project_to_summary(p) for p in rows]


def get_project_detail(db: Session, project_id: str) -> ProjectDetail | None:
    p = db.query(SegmentedProject).filter_by(id=project_id).first()
    if p is None:
        return None
    return project_to_detail(p)


def get_project_row(db: Session, project_id: str) -> SegmentedProject | None:
    return db.query(SegmentedProject).filter_by(id=project_id).first()


def get_chapter_row(
    db: Session, project_id: str, chapter_id: str
) -> SegmentedProjectChapter | None:
    ch = (
        db.query(SegmentedProjectChapter)
        .filter_by(id=chapter_id, project_id=project_id)
        .first()
    )
    return ch


def get_segment_row(
    db: Session, project_id: str, chapter_id: str, segment_id: str
) -> SegmentedProjectSegment | None:
    seg = (
        db.query(SegmentedProjectSegment)
        .filter_by(id=segment_id, chapter_id=chapter_id, project_id=project_id)
        .first()
    )
    return seg


def save_project(db: Session, project: ProjectIn) -> ProjectDetail:
    """Full-state save: reconcile chapters/segments with DB. Filesystem mirrored after flush."""
    p = db.query(SegmentedProject).filter_by(id=project.id).first()
    if p is None:
        p = SegmentedProject(id=project.id)
        db.add(p)

    p.name = project.name
    p.schema_version = project.schema_version
    p.layout = project.layout
    p.active_chapter_id = project.active_chapter_id
    p.original_text = project.original_text
    # P2 v2: 旁白文档当前活跃版本
    setattr(p, "active_narration_version", project.active_narration_version)
    # P2 v3: 整体动画主题
    setattr(p, "animation_theme", project.animation_theme)
    if project.created_at:
        p.created_at = _parse_iso(project.created_at)
    p.updated_at = datetime.utcnow()

    # Chapters
    existing_chapters = {c.id: c for c in p.chapters}
    keep_chapter_ids: set[str] = set()
    for ch_idx, ch_in in enumerate(project.chapters):
        ch = existing_chapters.get(ch_in.id)
        if ch is None:
            ch = SegmentedProjectChapter(id=ch_in.id, project_id=p.id)
            db.add(ch)
        ch.position = ch_in.position if ch_in.position is not None else ch_idx
        ch.name = ch_in.name
        ch.engine = ch_in.engine
        ch.default_params = _merge_chapter_meta_to_params(ch_in)
        ch.split_config = ch_in.split_config or {}
        ch.original_text = ch_in.original_text
        # P2 v2: 旁白文档关联 (绕过 Pyright 对 Column[] 类型的过度严格检查)
        setattr(ch, "narration_document_id", ch_in.narration_document_id)
        setattr(ch, "narration_version", ch_in.narration_version)
        setattr(ch, "narration_slice_start", ch_in.narration_slice_start)
        setattr(ch, "narration_slice_end", ch_in.narration_slice_end)
        setattr(ch, "narration_synced_at", _parse_iso(ch_in.narration_synced_at))
        if ch_in.created_at:
            ch.created_at = _parse_iso(ch_in.created_at)
        ch.updated_at = datetime.utcnow()
        keep_chapter_ids.add(ch_in.id)

        # Segments
        existing_segments = {s.id: s for s in ch.segments}
        keep_segment_ids: set[str] = set()
        for seg_idx, s_in in enumerate(ch_in.segments):
            seg = existing_segments.get(s_in.id)
            if seg is None:
                seg = SegmentedProjectSegment(
                    id=s_in.id, chapter_id=ch.id, project_id=p.id,
                )
                db.add(seg)
            seg.position = s_in.position if s_in.position is not None else seg_idx
            seg.text = s_in.text or ""
            seg.ssml = s_in.ssml
            seg.emotion = s_in.emotion
            seg.params = s_in.params or {}
            seg.locked_params = s_in.locked_params or []
            if s_in.generated_params is not None:
                seg.generated_params = s_in.generated_params
            if s_in.current_audio_path is not None:
                seg.current_audio_path = s_in.current_audio_path
            if s_in.previous_audio_path is not None:
                seg.previous_audio_path = s_in.previous_audio_path
            seg.audio_format = s_in.audio_format or seg.audio_format or "mp3"
            if s_in.duration_sec is not None:
                seg.duration_sec = s_in.duration_sec
            seg.audio_missing = bool(s_in.audio_missing)
            seg.generated_at = _parse_iso(s_in.generated_at)
            seg.ssml_annotated_by_llm = bool(s_in.ssml_annotated_by_llm)
            # P2 v3: 动画规格. None 表示"未指定", 保留旧值 (避免误清).
            # 显式清除请调 DELETE /api/.../segments/{id}/animation
            if s_in.animation_spec is not None:
                setattr(seg, "animation_spec_json", _dump_animation_spec(s_in.animation_spec))
            if s_in.created_at:
                seg.created_at = _parse_iso(s_in.created_at)
            seg.updated_at = datetime.utcnow()
            keep_segment_ids.add(s_in.id)

        # Remove orphan segments
        for seg in list(ch.segments):
            if seg.id not in keep_segment_ids:
                db.delete(seg)

    # Remove orphan chapters
    for ch in list(p.chapters):
        if ch.id not in keep_chapter_ids:
            db.delete(ch)

    db.flush()
    db.refresh(p)
    _mirror_to_filesystem(p, project)
    db.commit()
    return project_to_detail(p)


def _mirror_to_filesystem(p: SegmentedProject, project: ProjectIn) -> None:
    assets.write_original_text(p.id, p.original_text or "")
    for ch_in, ch in zip(project.chapters, p.chapters):
        assets.write_chapter_original_text(p.id, ch.id, ch.original_text or "")
        assets.ensure_project_layout(p.id, ch.id)
        for s_in in ch_in.segments:
            assets.write_segment_text(p.id, ch.id, s_in.id, s_in.text or "")
            if s_in.ssml is not None:
                assets.write_segment_ssml(p.id, ch.id, s_in.id, s_in.ssml)
    assets.write_manifest(p.id, project_to_detail(p).model_dump(mode="json"))


def delete_project(db: Session, project_id: str) -> bool:
    p = db.query(SegmentedProject).filter_by(id=project_id).first()
    if p is None:
        return False
    # P2 v2: 显式清理源 (FK CASCADE 在 SQLite 默认未启用, 不能依赖)
    from app.models.narration import SourceDocument, NarrationDocument
    db.query(SourceDocument).filter_by(project_id=project_id).delete(synchronize_session=False)
    db.query(NarrationDocument).filter_by(project_id=project_id).delete(synchronize_session=False)
    db.delete(p)
    db.commit()
    assets.remove_project_dir(project_id)
    return True


def apply_animation_spec(
    db: Session,
    project_id: str,
    theme: str | None,
    items: list[dict[str, Any]],
) -> dict[str, Any]:
    """P2 v3: 批量应用动画规格.

    items: list of {segment_id, visual_concept, layout, mood, phases, animations, elements, emphasis, asset_refs, notes}
    返回 {theme_updated, segments_updated, segments_skipped, missing_segment_ids}
    """
    p = db.query(SegmentedProject).filter_by(id=project_id).first()
    if p is None:
        raise LookupError(f"project_not_found: {project_id}")

    # 建 segment_id -> row 索引
    seg_index: dict[str, SegmentedProjectSegment] = {}
    for ch in p.chapters:
        for s in ch.segments:
            seg_index[s.id] = s

    theme_updated = False
    if theme is not None:
        setattr(p, "animation_theme", theme)
        theme_updated = True

    updated = 0
    missing: list[str] = []
    for it in items:
        seg_id = it.get("segment_id")
        if not seg_id:
            continue
        seg = seg_index.get(seg_id)
        if seg is None:
            missing.append(seg_id)
            continue
        # 合并: 只覆盖传入的非空字段, 保留未传的
        existing_raw = getattr(seg, "animation_spec_json", None)
        existing = _parse_animation_spec(existing_raw) or {}
        merged = dict(existing)
        for key in (
            "visual_concept", "layout", "mood",
            "phases", "animations", "elements",
            "emphasis", "asset_refs", "notes",
        ):
            v = it.get(key)
            if v is not None:
                merged[key] = v
        merged["generated_at"] = datetime.utcnow().isoformat()
        setattr(seg, "animation_spec_json", _dump_animation_spec(merged))
        updated += 1

    db.commit()
    return {
        "theme_updated": theme_updated,
        "segments_updated": updated,
        "segments_skipped": len(missing),
        "missing_segment_ids": missing,
    }


def update_segment_after_synth(
    db: Session,
    seg: SegmentedProjectSegment,
    *,
    current_audio_path: str,
    previous_audio_path: str | None,
    audio_format: str,
    duration_sec: float | None,
    generated_params: dict[str, Any],
) -> None:
    seg.current_audio_path = current_audio_path
    seg.previous_audio_path = previous_audio_path
    seg.audio_format = audio_format
    seg.duration_sec = duration_sec
    seg.generated_params = generated_params
    seg.generated_at = datetime.utcnow()
    seg.audio_missing = False
    seg.updated_at = datetime.utcnow()
    seg.chapter.updated_at = datetime.utcnow()
    seg.chapter.project.updated_at = datetime.utcnow()
    db.flush()
    assets.write_segment_text(seg.project_id, seg.chapter_id, seg.id, seg.text or "")
    if seg.ssml is not None:
        assets.write_segment_ssml(seg.project_id, seg.chapter_id, seg.id, seg.ssml)
    db.commit()


# ----- synthesis orchestration -----


def _merge_params(*sources: dict[str, Any] | None) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for s in sources:
        if s:
            for k, v in s.items():
                if v is not None:
                    out[k] = v
    return out


def synthesize_with_engine(
    engine: str, text: str, params: dict[str, Any]
) -> tuple[bytes, str]:
    """Dispatch to the existing TTS service. Returns (audio_bytes, native_format)."""
    if engine == "edge_tts":
        from app.api.tts import synthesize_speech_internal
        return synthesize_speech_internal(
            text=text, voice_id="",
            edge_voice=params.get("edge_voice"),
            edge_rate=params.get("edge_rate"),
            edge_volume=params.get("edge_volume"),
        )
    if engine == "cosyvoice":
        from app.api.tts import synthesize_speech_internal
        return synthesize_speech_internal(
            text=text,
            voice_id=params.get("voice_id", ""),
            speed=params.get("speed", 1.0),
            volume=params.get("volume", 80),
            pitch=params.get("pitch", 1.0),
            instruction=params.get("instruction", ""),
            enable_ssml=params.get("enable_ssml", False),
            enable_markdown_filter=params.get("enable_markdown_filter", False),
            language=params.get("language", "Chinese"),
        )
    if engine == "mimo_tts":
        from app.api.mimo_tts import synthesize_mimo_internal
        return synthesize_mimo_internal(
            text=text,
            mimo_mode=params.get("mimo_mode", "preset"),
            preset_voice=params.get("mimo_preset_voice"),
            clone_voice_id=params.get("mimo_clone_voice_id"),
            instruction=params.get("mimo_instruction", ""),
        )
    raise ValueError(f"Unsupported engine: {engine}")


def svc_get_segment(
    db: Session, project_id: str, chapter_id: str, segment_id: str
) -> SegmentedProjectSegment:
    seg = get_segment_row(db, project_id, chapter_id, segment_id)
    if seg is None:
        raise LookupError(f"segment {segment_id} not found in project {project_id}")
    return seg


def synthesize_segment(
    db: Session,
    project_id: str,
    chapter_id: str,
    segment_id: str,
    request_params: dict[str, Any] | None = None,
    text_override: str | None = None,
    ssml_override: str | None = None,
    keep_previous: bool = True,
) -> SegmentedProjectSegment:
    seg = svc_get_segment(db, project_id, chapter_id, segment_id)
    chapter = seg.chapter
    effective = _merge_params(chapter.default_params, seg.params, request_params)
    engine = effective.get("engine", "edge_tts")
    text_to_speak = text_override or seg.text or ""
    if ssml_override is not None:
        effective["ssml"] = ssml_override

    if not is_ffmpeg_available():
        logger.warning("ffmpeg unavailable; writing wav fallback for segment %s", seg.id)

    audio_bytes, _native_fmt = synthesize_with_engine(engine, text_to_speak, effective)
    assets.ensure_project_layout(project_id, chapter_id)

    prev_rel: str | None = seg.current_audio_path

    if is_ffmpeg_available():
        target_mp3 = assets.segment_audio_path(project_id, chapter_id, seg.id, "mp3")
        transcode_to_mp3(audio_bytes, target_mp3)
        new_rel = target_mp3.relative_to(assets.settings.segmented_dir).as_posix()
        audio_format = "mp3"
        # Probe the actual duration we just wrote. Never raise — None is fine
        # (frontend falls back to a rough estimate from text length).
        try:
            duration_sec = probe_audio_duration(target_mp3)
        except Exception as e:  # noqa: BLE001
            logger.warning("probe_audio_duration failed for %s: %s", new_rel, e)
            duration_sec = None
    else:
        wav_path = assets.segment_audio_path(project_id, chapter_id, seg.id, "wav")
        wav_path.write_bytes(audio_bytes)
        new_rel = wav_path.relative_to(assets.settings.segmented_dir).as_posix()
        audio_format = "wav"
        duration_sec = None

    if not keep_previous and prev_rel:
        try:
            (assets.settings.segmented_dir / prev_rel).unlink()
        except FileNotFoundError:
            pass
        prev_rel = None

    update_segment_after_synth(
        db, seg,
        current_audio_path=new_rel,
        previous_audio_path=prev_rel,
        audio_format=audio_format,
        duration_sec=duration_sec,
        generated_params=effective,
    )


# Files below this size (bytes) are treated as "definitely not real speech".
# The old synthesize_speech_internal stub produced exactly 2205-byte MP3s;
# any real TTS output (Edge TTS, CosyVoice) is at least ~5KB for a single
# short sentence, so 5KB is a conservative threshold that won't false-positive
# on legitimate small clips.
_SILENT_FILE_THRESHOLD_BYTES = 5_000


def mark_silent_segments_as_missing(
    db: Session,
    *,
    base_dir: Path | None = None,
    min_size_bytes: int = _SILENT_FILE_THRESHOLD_BYTES,
) -> dict[str, int]:
    """Scan every segment with a backend audio file and flag suspiciously
    small files as ``audio_missing=True``.

    Idempotent: segments already marked are left alone. The audio file on
    disk is NOT deleted — the user may still want to inspect or recover it.

    Returns a dict with ``scanned``, ``marked``, ``already_missing``,
    ``file_missing`` counts so callers can log progress and tests can assert.
    """
    from app.core.config import settings
    from app.models.segmented_project import SegmentedProjectSegment

    base = Path(base_dir) if base_dir else Path(settings.segmented_dir)

    scanned = marked = already_missing = file_missing = 0

    segs = (
        db.query(SegmentedProjectSegment)
        .filter(SegmentedProjectSegment.current_audio_path.isnot(None))
        .all()
    )

    for seg in segs:
        scanned += 1
        if seg.audio_missing:
            already_missing += 1
            continue

        rel = seg.current_audio_path
        # current_audio_path is stored relative to settings.segmented_dir
        # (see synthesize_segment / save_project).
        abs_path = base / rel if not Path(rel).is_absolute() else Path(rel)
        if not abs_path.exists():
            seg.audio_missing = True
            marked += 1
            file_missing += 1
            continue

        try:
            size = abs_path.stat().st_size
        except OSError:
            seg.audio_missing = True
            marked += 1
            file_missing += 1
            continue

        if size < min_size_bytes:
            seg.audio_missing = True
            marked += 1

    if marked:
        db.commit()

    return {
        "scanned": scanned,
        "marked": marked,
        "already_missing": already_missing,
        "file_missing": file_missing,
    }
