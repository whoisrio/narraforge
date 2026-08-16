"""Business logic for segmented project CRUD and asset mirroring."""
from __future__ import annotations

import copy
import json
import logging
import os
import re
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.schemas.segmented_project import SynthesizeParams

from sqlalchemy.orm import Session

from app.core import segmented_assets as assets
from app.core.audio_encoder import (
    AudioEncoderError,
    adjust_audio_speed_volume,
    concat_to_mp3,
    is_ffmpeg_available,
    probe_audio_duration,
    transcode_to_mp3,
    trim_audio_silence_bytes,
)
from app.models.segmented_project import (
    SegmentedProject,
    SegmentedProjectChapter,
    SegmentedProjectSegment,
)
from app.services.engine_capabilities import prepare_text_for_engine
from app.core.time_utils import utcnow
from app.schemas.segmented_project import (
    ChapterIn,
    ProjectDetail,
    ProjectIn,
    ProjectSummary,
    SegmentIn,
)

logger = logging.getLogger(__name__)


# ----- helpers -----


def _ends_with_sentence_period(text: str) -> bool:
    return re.search(r"[。．\.](?:[”\"』」》）\)]*)\s*$", (text or "").strip()) is not None

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


# P2 v3: animation_spec 编解码实现已迁至 app.services.animation_spec_codec
# （纯函数、无 ORM 依赖，workers 的 Supabase 仓储也用）；此处 re-export
# 保持 `from app.services.segmented_project_service import _dump_animation_spec`
# 历史路径不变。
from app.services.animation_spec_codec import (
    _dump_animation_spec,
    _parse_animation_spec,
)


def _duration_from_bytes(audio_bytes: bytes, fmt: str) -> float | None:
    """Compute audio duration from raw bytes using pydub. Returns None on failure."""
    import io
    try:
        from pydub import AudioSegment
        seg_audio = AudioSegment.from_file(io.BytesIO(audio_bytes), format=fmt)
        return round(seg_audio.duration_seconds, 2)
    except Exception:
        return None


# ----- serialization -----

def project_to_summary(p: SegmentedProject) -> ProjectSummary:
    chapter_count = len(p.chapters)
    segment_count = 0
    generated_count = 0
    duration_sec = 0.0
    for chapter in p.chapters:
        segment_count += len(chapter.segments)
        for segment in chapter.segments:
            audio = segment.audio or {}
            if audio.get("current", {}).get("path"):
                generated_count += 1
            duration_sec += float(audio.get("current", {}).get("duration_sec", 0))
    return ProjectSummary(
        id=p.id,
        name=p.name,
        schema_version=p.schema_version,
        layout=p.layout,
        active_chapter_id=p.active_chapter_id,
        remotion_project_path=getattr(p, "remotion_project_path", None),
        summary_stats={
            "chapter_count": chapter_count,
            "segment_count": segment_count,
            "generated_count": generated_count,
            "duration_sec": round(duration_sec, 2),
        },
        created_at=_to_iso(p.created_at) or "",
        updated_at=_to_iso(p.updated_at) or "",
    )


def _chapter_voice_to_api(voice: dict[str, Any]) -> dict[str, Any]:
    """Return chapter voice as API-ready EngineParams dict."""
    return dict(voice or {})


def _flatten_voice_for_synthesis(voice: dict[str, Any]) -> dict[str, Any]:
    """Convert EngineParams to flat dict for synthesis parameter merge."""
    engine = voice.get("engine", "edge_tts")
    flat: dict[str, Any] = {"engine": engine}
    if engine == "edge_tts":
        flat["edge_voice"] = voice.get("voice", "") or "zh-CN-YunxiNeural"
        flat["edge_rate"] = voice.get("rate", "+0%")
        flat["edge_volume"] = voice.get("volume", "+0%")
    elif engine == "cosyvoice":
        flat["voice_id"] = voice.get("voice_id", "")
        flat["speed"] = voice.get("speed", 1.0)
        flat["volume"] = voice.get("volume", 80)
        flat["pitch"] = voice.get("pitch", 1.0)
        flat["language"] = voice.get("language", "Chinese")
        flat["instruction"] = voice.get("instruction", "")
    elif engine == "mimo_tts":
        flat["mimo_mode"] = voice.get("mode", "preset")
        flat["mimo_preset_voice"] = voice.get("voice_id", "")
        flat["mimo_clone_voice_id"] = voice.get("voice_id", "")
        flat["mimo_instruction"] = voice.get("instruction", "")
        flat["mimo_voice_description"] = voice.get("voice_description", "")
    elif engine == "voxcpm":
        flat["voxcpm_mode"] = voice.get("mode", "clone")
        flat["voice_id"] = voice.get("voice_id", "")
        flat["voxcpm_style_control"] = voice.get("style_control", "")
        flat["voxcpm_cfg_value"] = voice.get("cfg_value", 2.0)
        flat["voxcpm_inference_timesteps"] = voice.get("inference_timesteps", 10)
    if voice.get("mute_tags") is not None:
        flat["mute_tags"] = voice.get("mute_tags")
    return flat


def _audio_with_file_exists(audio: dict[str, Any] | None) -> dict[str, Any] | None:
    """Return a copy of ``audio`` with ``current.file_exists`` set.

    ``file_exists`` reflects whether the referenced audio file is still on
    disk, so the frontend can mark desynced segments (DB path set, file gone)
    as not ready instead of trusting the stored path. The stored dict is
    never mutated (avoids dirtying the ORM row on read).
    """
    if not isinstance(audio, dict):
        return audio
    out = dict(audio)
    current = out.get("current")
    if isinstance(current, dict):
        current_out = dict(current)
        rel = current_out.get("path")
        current_out["file_exists"] = bool(
            isinstance(rel, str)
            and rel
            and (assets.settings.segmented_dir / rel).exists()
        )
        out["current"] = current_out
    return out


def project_to_detail(p: SegmentedProject) -> ProjectDetail:
    chapters = []
    for ch in p.chapters:
        voice = getattr(ch, "voice", None) or {}
        segs = [
            SegmentIn(
                id=s.id, position=s.position, text=s.text,
                emotion=s.emotion,
                role_id=getattr(s, "role_id", None),
                segment_kind=getattr(s, "segment_kind", None) or "narration",
                voice=getattr(s, "voice", {}) or {"source": "chapter"},
                generated_params=s.generated_params,
                audio=_audio_with_file_exists(getattr(s, "audio", None)),
                generated_at=_to_iso(s.generated_at),
                animation_spec=_parse_animation_spec(s.animation_spec_json),
                created_at=_to_iso(s.created_at),
                updated_at=_to_iso(s.updated_at),
            )
            for s in ch.segments
        ]
        chapters.append(
            ChapterIn(
                id=ch.id, position=ch.position, name=ch.name,
                voice=voice,
                split_config=ch.split_config or {},
                original_text=ch.original_text,
                narration_script=getattr(ch, "narration_script", None),
                design_title=getattr(ch, "design_title", None),
                audio_adjust=getattr(ch, "audio_adjust", None),
                created_at=_to_iso(ch.created_at),
                updated_at=_to_iso(ch.updated_at),
                segments=segs,
            )
        )
    return ProjectDetail(
        id=p.id, name=p.name, schema_version=p.schema_version,
        layout=p.layout, active_chapter_id=p.active_chapter_id,
        original_text=p.original_text,
        animation_theme=getattr(p, "animation_theme", None),
        remotion_project_path=getattr(p, "remotion_project_path", None),
        source_document=assets.read_project_document(getattr(p, "source_document_path", None))
            or getattr(p, "source_document", None),
        narration_script=assets.read_project_document(getattr(p, "narration_document_path", None)),
        source_document_path=getattr(p, "source_document_path", None),
        narration_document_path=getattr(p, "narration_document_path", None),
        default_narrator_role_id=getattr(p, "default_narrator_role_id", None),
        logo=getattr(p, "logo", None),
        configs=getattr(p, "configs", None),
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
        .filter_by(id=segment_id, chapter_id=chapter_id)
        .first()
    )
    return seg


def _audio_path_str(ref: object) -> str | None:
    """Extract the filesystem path from an audio.current/previous ref, if any."""
    if isinstance(ref, dict):
        p = ref.get("path")
        if isinstance(p, str) and p:
            return p
    return None


def _delete_segment_audio_files(seg: SegmentedProjectSegment) -> None:
    """Delete a segment's generated audio files (current + previous) from disk.

    Used when chapters are replaced wholesale (e.g. re-splitting by heading):
    the DB rows are cascade-deleted, but the audio assets on disk would be
    orphaned without this. Reads the stored path from ``seg.audio`` so it works
    for any historical layout.
    """
    if not seg.audio:
        return
    try:
        audio_data = seg.audio if isinstance(seg.audio, dict) else json.loads(seg.audio)
    except Exception:
        return
    for slot in ("current", "previous"):
        entry = audio_data.get(slot)
        if isinstance(entry, dict) and isinstance(entry.get("path"), str):
            assets.delete_audio_file(entry["path"])


def _delete_dropped_audio_files(seg: SegmentedProjectSegment, new_audio: dict) -> None:
    """Delete audio files the incoming audio state no longer references.

    Covers the merge flow: the frontend clears a kept segment's audio, and
    without this the old file would be orphaned on disk. Paths still referenced
    (e.g. old ``current`` demoted to ``previous`` after regeneration) are kept.
    """
    old = seg.audio
    if isinstance(old, str):
        try:
            old = json.loads(old)
        except (ValueError, TypeError):
            old = None
    if not isinstance(old, dict):
        return
    keep = {p for p in (_audio_path_str(new_audio.get("current")),
                        _audio_path_str(new_audio.get("previous"))) if p}
    for key in ("current", "previous"):
        path_str = _audio_path_str(old.get(key))
        if path_str and path_str not in keep:
            try:
                fp = Path(path_str)
                if not fp.is_absolute():
                    fp = assets.settings.segmented_dir / fp
                if fp.exists():
                    fp.unlink()
            except Exception:
                pass


def _relocate_project_assets(p: SegmentedProject, old_name: str, new_name: str) -> None:
    """Project renamed: move the asset dir to the new slug and rewrite stored paths.

    Runs inside save_project's transaction. If the move fails we leave BOTH
    the directory and DB paths untouched (old paths remain valid) — degraded
    but never half-migrated.
    """
    old_dir = assets.project_dir(p.id, old_name)
    new_dir = assets.project_dir(p.id, new_name)
    if old_dir == new_dir or not old_dir.exists():
        return
    if new_dir.exists():
        logger.warning("rename relocation skipped, target exists: %s", new_dir)
        return
    try:
        new_dir.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(old_dir), str(new_dir))
    except OSError as e:
        logger.warning("rename relocation failed for project %s: %s", p.id, e)
        return

    old_prefix, new_prefix = old_dir.name, new_dir.name
    for ch in p.chapters:
        for seg in ch.segments:
            audio = seg.audio
            if not isinstance(audio, dict):
                continue
            updated = copy.deepcopy(audio)
            changed = False
            for key in ("current", "previous"):
                rel = _audio_path_str(updated.get(key))
                if rel and (rel == old_prefix or rel.startswith(old_prefix + "/")):
                    updated[key]["path"] = new_prefix + rel[len(old_prefix):]
                    changed = True
            if changed:
                seg.audio = updated
    for attr in ("source_document_path", "narration_document_path"):
        stored = getattr(p, attr, None)
        if isinstance(stored, str) and stored.startswith(str(old_dir)):
            setattr(p, attr, str(new_dir) + stored[len(str(old_dir)):])


def save_project(db: Session, project: ProjectIn) -> ProjectDetail:
    """Full-state save: reconcile chapters/segments with DB. Filesystem mirrored after flush."""
    p = db.query(SegmentedProject).filter_by(id=project.id).first()
    if p is None:
        p = SegmentedProject(id=project.id)
        db.add(p)

    rename_from = p.name if p.name and p.name != project.name else None

    p.name = project.name
    p.schema_version = project.schema_version
    p.layout = project.layout
    p.active_chapter_id = project.active_chapter_id
    p.original_text = project.original_text
    # 项目级长文档（源文档/旁白稿）内容落文件，DB 只存路径；旧 TEXT 列仅作遗留回退
    if project.source_document is not None:
        p.source_document_path = assets.write_project_document(
            project.id, kind="source",
            project_name=project.name, text=project.source_document,
        )
        p.source_document = None
    if project.narration_script is not None:
        p.narration_document_path = assets.write_project_document(
            project.id, kind="narration",
            project_name=project.name, text=project.narration_script,
        )
    setattr(p, "animation_theme", project.animation_theme)
    setattr(p, "remotion_project_path", project.remotion_project_path)
    setattr(p, "default_narrator_role_id", project.default_narrator_role_id)
    setattr(p, "configs", project.configs)
    setattr(p, "logo", project.logo)
    if project.created_at:
        p.created_at = _parse_iso(project.created_at)
    p.updated_at = utcnow()

    # Chapters
    # Phase 1: move existing positions to negative sentinel values so that
    # swap reorders (A:0→1, B:1→0) don't violate the unique constraint
    # during the batched UPDATE.  SQLite enforces UNIQUE per-row, not
    # per-statement, so A:0→1 would collide with B's still-current position 1.
    existing_chapters = {c.id: c for c in p.chapters}
    for tmp_idx, ch in enumerate(p.chapters):
        ch.position = -(tmp_idx + 1)
    db.flush()
    # Phase 2: assign final positions from the payload.
    keep_chapter_ids: set[str] = set()
    for ch_idx, ch_in in enumerate(project.chapters):
        ch = existing_chapters.get(ch_in.id)
        if ch is None:
            ch = SegmentedProjectChapter(id=ch_in.id, project_id=p.id)
            db.add(ch)
        ch.position = ch_in.position if ch_in.position is not None else ch_idx
        ch.name = ch_in.name
        ch.voice = ch_in.voice or {}
        ch.split_config = ch_in.split_config or {}
        ch.original_text = ch_in.original_text
        setattr(ch, "narration_script", ch_in.narration_script)
        setattr(ch, "design_title", ch_in.design_title)
        # audio_adjust 只能由 adjust-audio 端点管理；payload 中的值一律忽略，
        # 保留 DB 现值（payload 直写会绕过 tempo/volume_db 范围校验）
        if ch_in.created_at:
            ch.created_at = _parse_iso(ch_in.created_at)
        ch.updated_at = utcnow()
        keep_chapter_ids.add(ch_in.id)

        # Segments — same two-phase approach as chapters.
        existing_segments = {s.id: s for s in ch.segments}
        for tmp_idx, seg in enumerate(ch.segments):
            seg.position = -(tmp_idx + 1)
        db.flush()
        keep_segment_ids: set[str] = set()
        for seg_idx, s_in in enumerate(ch_in.segments):
            seg = existing_segments.get(s_in.id)
            if seg is None:
                seg = SegmentedProjectSegment(
                    id=s_in.id, chapter_id=ch.id,
                )
                db.add(seg)
            seg.position = s_in.position if s_in.position is not None else seg_idx
            seg.text = s_in.text or ""
            seg.emotion = s_in.emotion
            setattr(seg, "role_id", s_in.role_id)
            setattr(seg, "segment_kind", s_in.segment_kind or "narration")
            setattr(seg, "voice", s_in.voice or {"source": "chapter"})
            if s_in.generated_params is not None:
                seg.generated_params = s_in.generated_params
            if s_in.audio is not None:
                _delete_dropped_audio_files(seg, s_in.audio)
                setattr(seg, "audio", s_in.audio)
            seg.generated_at = _parse_iso(s_in.generated_at)
            if s_in.animation_spec is not None:
                setattr(seg, "animation_spec_json", _dump_animation_spec(s_in.animation_spec))
            if s_in.created_at:
                seg.created_at = _parse_iso(s_in.created_at)
            seg.updated_at = utcnow()
            keep_segment_ids.add(s_in.id)

        # Remove orphan segments
        for seg in list(ch.segments):
            if seg.id not in keep_segment_ids:
                # Clean up audio files from disk before removing the DB row.
                # Prefer the DB-stored path (works for any historical layout);
                # reconstructing the current-scheme path is only a fallback.
                if seg.audio:
                    try:
                        audio_data = seg.audio if isinstance(seg.audio, dict) else json.loads(seg.audio)
                        removed = False
                        for slot in ("current", "previous"):
                            entry = audio_data.get(slot)
                            if isinstance(entry, dict) and isinstance(entry.get("path"), str):
                                removed = assets.delete_audio_file(entry["path"]) or removed
                        if not removed:
                            current = audio_data.get('current')
                            if current and isinstance(current, dict):
                                fmt = current.get('format', 'mp3')
                                assets.remove_segment_audio(
                                    project.id, ch.id,
                                    project_name=project.name,
                                    segment_id=seg.id,
                                    fmt=fmt,
                                )
                    except Exception:
                        pass
                db.delete(seg)

    # Remove orphan chapters
    for ch in list(p.chapters):
        if ch.id not in keep_chapter_ids:
            db.delete(ch)

    # Rename relocation happens AFTER reconcile: the payload carries stale
    # (pre-rename) paths, so we rewrite the final DB state, not the payload.
    if rename_from:
        _relocate_project_assets(p, rename_from, project.name)

    db.flush()
    db.refresh(p)
    _mirror_to_filesystem(p, project)
    db.commit()
    return project_to_detail(p)


def _mirror_to_filesystem(p: SegmentedProject, project: ProjectIn) -> None:
    assets.write_original_text(p.id, p.original_text or "", project_name=p.name)
    for ch_in, ch in zip(project.chapters, p.chapters):
        assets.write_chapter_original_text(
            p.id, ch.id,
            project_name=p.name,
            text=ch.original_text or "",
        )
        assets.ensure_chapter_layout(
            p.id, ch.id,
            project_name=p.name,
        )
        for s_in in ch_in.segments:
            assets.write_segment_text(
                p.id, ch.id,
                project_name=p.name,
                segment_id=s_in.id,
                text=s_in.text or "",
            )
    assets.write_manifest(p.id, project_to_detail(p).model_dump(mode="json"), project_name=p.name)


def delete_project(db: Session, project_id: str) -> bool:
    p = db.query(SegmentedProject).filter_by(id=project_id).first()
    if p is None:
        return False
    # 显式清理源 (FK CASCADE 在 SQLite 默认未启用, 不能依赖)
    from app.models.source_document import SourceDocument
    db.query(SourceDocument).filter_by(project_id=project_id).delete(synchronize_session=False)
    db.delete(p)
    db.commit()
    assets.remove_project_dir(project_id, p.name)
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
        # 合并: 覆盖传入的所有非 None 字段 (segment_id 除外), 保留未传的
        existing_raw = getattr(seg, "animation_spec_json", None)
        existing = _parse_animation_spec(existing_raw) or {}
        merged = dict(existing)
        for key, v in it.items():
            if key == "segment_id" or v is None:
                continue
            merged[key] = v
        merged["generated_at"] = utcnow().isoformat()
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
    previous_duration_sec: float | None = None,
    audio_format: str,
    duration_sec: float | None,
    generated_params: dict[str, Any],
    current_origin: str = "tts",
    previous_origin: str | None = None,
) -> None:
    audio_data = {
        "format": audio_format,
        "current": {
            "path": current_audio_path,
            "format": audio_format,
            "origin": current_origin,
        },
    }
    if duration_sec is not None:
        audio_data["current"]["duration_sec"] = duration_sec
        # 顶层 duration_sec 是时间轴/SRT 的读取源，与 current 保持一致（D7）
        audio_data["duration_sec"] = duration_sec
    if previous_audio_path:
        prev_entry: dict[str, Any] = {"path": previous_audio_path}
        if previous_duration_sec is not None:
            prev_entry["duration_sec"] = previous_duration_sec
        if previous_origin is not None:
            prev_entry["origin"] = previous_origin
        audio_data["previous"] = prev_entry
    seg.audio = audio_data
    seg.generated_params = generated_params
    seg.generated_at = utcnow()
    seg.updated_at = utcnow()
    seg.chapter.updated_at = utcnow()
    seg.chapter.project.updated_at = utcnow()
    db.flush()
    assets.write_segment_text(
        seg.project_id, seg.chapter_id,
        chapter_title=seg.chapter.name or "",
        project_name=seg.chapter.project.name,
        segment_id=seg.id,
        position=seg.position or 0,
        text=seg.text or "",
    )
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
    text: str, p: SynthesizeParams, db: Session | None = None
) -> tuple[bytes, str]:
    """Dispatch to the existing TTS service. Returns (audio_bytes, native_format)."""
    engine = p.engine
    logger.info(
        "[synthesize_with_engine] engine=%s mimo_mode=%s mimo_clone=%s voxcpm_mode=%s voice_id=%s",
        engine, p.mimo_mode, p.mimo_clone_voice_id, p.voxcpm_mode, p.voice_id)
    if engine == "edge_tts":
        from app.api.tts import synthesize_speech_internal
        return synthesize_speech_internal(
            text=text, voice_id="",
            edge_voice=p.edge_voice,
            edge_rate=p.edge_rate,
            edge_volume=p.edge_volume,
        )
    if engine == "cosyvoice":
        from app.api.tts import synthesize_speech_internal
        return synthesize_speech_internal(
            text=text,
            voice_id=p.voice_id,
            speed=p.speed,
            volume=p.volume,
            pitch=p.pitch,
            instruction=p.instruction,
            enable_ssml=p.enable_ssml,
            enable_markdown_filter=p.enable_markdown_filter,
            language=p.language,
            db=db,
        )
    if engine == "mimo_tts":
        from app.api.mimo_tts import synthesize_mimo_internal
        return synthesize_mimo_internal(
            text=text,
            mimo_mode=p.mimo_mode,
            preset_voice=p.mimo_preset_voice,
            clone_voice_id=p.mimo_clone_voice_id,
            voice_description=p.mimo_voice_description,
            instruction=p.mimo_instruction,
            context=p.context,
            db=db,
        )
    if engine == "voxcpm":
        from app.api.voxcpm import synthesize_voxcpm_internal
        return synthesize_voxcpm_internal(
            text=text,
            mode=p.voxcpm_mode,
            voice_id=p.voice_id,
            voice_description=p.voxcpm_voice_description,
            style_control=p.voxcpm_style_control,
            prompt_text=p.voxcpm_prompt_text,
            cfg_value=p.voxcpm_cfg_value,
            inference_timesteps=p.voxcpm_inference_timesteps,
            db=db,
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
    force: bool = False,
) -> SegmentedProjectSegment:
    seg = svc_get_segment(db, project_id, chapter_id, segment_id)
    chapter = seg.chapter

    # Segments with user-recorded audio are locked by default: batch/agent
    # synthesis must not silently overwrite a human recording. Callers that
    # really mean to regenerate (e.g. explicit user action after unlock) pass
    # force=True; the recording is still demoted to `previous` for undo.
    existing_audio_check = seg.audio or {}
    current_check = (
        existing_audio_check.get("current", {})
        if isinstance(existing_audio_check, dict) else {}
    )
    if not force and current_check.get("origin") == "recorded":
        logger.info(
            "[synthesize_segment] segment %s has recorded audio; skipping", seg.id)
        return seg

    # Get role voice parameters if role_id is set
    role_id = getattr(seg, "role_id", None)
    role_params: dict[str, Any] | None = None
    if role_id:
        from app.models.role import Role
        role = db.query(Role).filter_by(id=role_id).first()
        if role and role.voice:
            role_params = role.voice.get("params", {}) if isinstance(role.voice, dict) else {}

    effective = _merge_params(_flatten_voice_for_synthesis(chapter.voice or {}), role_params, request_params)
    logger.info("[synthesize_segment] chapter.voice=%s role_params=%s request_params=%s merged=%s",
                 chapter.voice, role_params, request_params, effective)

    # Preserve role_id and segment_kind for reproducibility
    if role_id is not None:
        effective["role_id"] = role_id
    effective["segment_kind"] = getattr(seg, "segment_kind", None) or "narration"

    sp = SynthesizeParams(**effective)
    text_to_speak = text_override or seg.text or ""

    # 风格 tag 引擎适配：按引擎能力清洗/标注待合成文本
    style: str | None = None
    if sp.engine == "voxcpm":
        style = sp.voxcpm_style_control or None
    elif sp.engine == "mimo_tts":
        style = sp.mimo_instruction or None
    elif sp.engine == "cosyvoice":
        style = sp.instruction or None
    # 项目级全局开关（项目设置 configs.underscore_to_space）：
    # 与请求/章节参数任一开启即生效；只影响合成文本，不影响显示/字幕
    project_configs = chapter.project.configs if isinstance(chapter.project.configs, dict) else {}
    underscore_to_space = bool(sp.underscore_to_space) or bool(project_configs.get("underscore_to_space"))
    text_to_speak = prepare_text_for_engine(
        text_to_speak,
        engine=sp.engine,
        emotion=getattr(seg, "emotion", None),
        style=style,
        voxcpm_mode=sp.voxcpm_mode if sp.engine == "voxcpm" else None,
        mute_tags=bool(sp.mute_tags),
        underscore_to_space=underscore_to_space,
    )

    if not is_ffmpeg_available():
        logger.warning("ffmpeg unavailable; writing wav fallback for segment %s", seg.id)

    audio_bytes, _native_fmt = synthesize_with_engine(text_to_speak, sp, db=db)
    chapter_title = chapter.name or ""
    project_name = chapter.project.name
    assets.ensure_chapter_layout(
        project_id, chapter_id,
        chapter_title=chapter_title, project_name=project_name,
    )

    existing_audio = seg.audio or {}
    prev_current = existing_audio.get("current", {}) if isinstance(existing_audio, dict) else {}
    prev_rel: str | None = prev_current.get("path")
    prev_duration: float | None = prev_current.get("duration_sec")
    prev_origin: str | None = prev_current.get("origin")
    adjust_applied = False

    if is_ffmpeg_available():
        target_mp3 = assets.segment_audio_path(
            project_id, chapter_id,
            chapter_title=chapter_title, project_name=project_name,
            segment_id=seg.id, position=seg.position or 0, fmt="mp3",
        )
        leading_keep_ms = 80
        trailing_keep_ms = 100 if _ends_with_sentence_period(str(text_to_speak)) else 80
        try:
            audio_bytes = trim_audio_silence_bytes(
                audio_bytes,
                leading_keep_ms=leading_keep_ms,
                trailing_keep_ms=trailing_keep_ms,
            )
        except AudioEncoderError as e:
            logger.warning("silence trim skipped for segment %s: %s", seg.id, e)
        transcode_to_mp3(audio_bytes, target_mp3)
        new_rel = target_mp3.relative_to(assets.settings.segmented_dir).as_posix()
        audio_format = "mp3"
        try:
            duration_sec = probe_audio_duration(target_mp3)
        except Exception as e:  # noqa: BLE001
            logger.warning("probe_audio_duration failed for %s: %s", new_rel, e)
            duration_sec = None
        # Fallback: compute duration from raw bytes when ffprobe is unavailable
        if duration_sec is None and audio_bytes:
            duration_sec = _duration_from_bytes(audio_bytes, "mp3")

        # Apply chapter-level audio_adjust (atempo/volume) to the freshly
        # synthesized audio, mirroring adjust_chapter_audio's contract:
        # stash the fresh original as audio.previous (.prev.mp3) and render
        # the adjusted version into current. A later bulk re-adjust renders
        # from this previous (no cascade); an identity revert restores it.
        adj_rec = chapter.audio_adjust if isinstance(chapter.audio_adjust, dict) else None
        adj_tempo = (adj_rec or {}).get("tempo")
        adj_vol = (adj_rec or {}).get("volume_db")
        if (
            adj_tempo is not None and abs(float(adj_tempo) - 1.0) > 1e-9
        ) or (
            adj_vol is not None and abs(float(adj_vol)) > 1e-9
        ):
            adj_tempo_v = float(adj_tempo) if adj_tempo is not None else 1.0
            adj_vol_v = float(adj_vol) if adj_vol is not None else 0.0
            prev_abs = target_mp3.with_name(f"{seg.id}.prev.mp3")
            shutil.copy2(target_mp3, prev_abs)
            try:
                adjust_audio_speed_volume(
                    prev_abs, target_mp3,
                    tempo=adj_tempo_v, volume_db=adj_vol_v,
                )
            except AudioEncoderError as e:
                # 变速失败 = 本次合成失败：不留 1.0x 半成品冒充已变速，
                # 清掉 stash 后抛错，由上层把 segment 标记为失败。
                try:
                    prev_abs.unlink()
                except FileNotFoundError:
                    pass
                raise AudioEncoderError(
                    f"chapter audio adjust failed for segment {seg.id}: {e}",
                ) from e
            else:
                prev_rel = prev_abs.relative_to(
                    assets.settings.segmented_dir,
                ).as_posix()
                prev_duration = duration_sec
                # The `.prev.mp3` stash is the fresh TTS original (pre-adjust),
                # not whatever audio the segment had before this synthesis.
                prev_origin = "tts"
                new_duration = probe_audio_duration(target_mp3)
                if new_duration is None:
                    # probe 失败不吞成 None（SRT 会按 0s 处理）：
                    # 回退到「变速前时长 ÷ tempo」估算（音量调整不改变时长）。
                    if duration_sec is not None:
                        new_duration = duration_sec / adj_tempo_v
                    logger.warning(
                        "probe after adjust failed for %s; estimated duration %s",
                        new_rel, new_duration,
                    )
                duration_sec = new_duration
                _delete_dropped_audio_files(
                    seg, {"current": {"path": new_rel}, "previous": {"path": prev_rel}},
                )
                adjust_applied = True
    else:
        wav_path = assets.segment_audio_path(
            project_id, chapter_id,
            chapter_title=chapter_title, project_name=project_name,
            segment_id=seg.id, position=seg.position or 0, fmt="wav",
        )
        wav_path.write_bytes(audio_bytes)
        new_rel = wav_path.relative_to(assets.settings.segmented_dir).as_posix()
        audio_format = "wav"
        duration_sec = _duration_from_bytes(audio_bytes, "wav") if audio_bytes else None

    if not adjust_applied and not keep_previous and prev_rel:
        try:
            (assets.settings.segmented_dir / prev_rel).unlink()
        except FileNotFoundError:
            pass
        prev_rel = None
        prev_origin = None

    update_segment_after_synth(
        db, seg,
        current_audio_path=new_rel,
        previous_audio_path=prev_rel,
        previous_duration_sec=prev_duration,
        audio_format=audio_format,
        duration_sec=duration_sec,
        generated_params=effective,
        current_origin="tts",
        previous_origin=prev_origin,
    )
    return seg


# ----- user-recorded segment audio -----

RECORDED_AUDIO_EXTS = {"mp3", "wav", "webm", "ogg", "m4a"}


def save_recorded_segment_audio(
    db: Session,
    project_id: str,
    chapter_id: str,
    segment_id: str,
    *,
    audio_bytes: bytes,
    filename: str,
    duration_sec: float | None = None,
) -> SegmentedProjectSegment:
    """Store a user-recorded/uploaded audio file as the segment's current audio.

    The recording is marked ``origin: 'recorded'`` so batch/agent synthesis
    skips it (locked). Any existing current audio is demoted to ``previous``
    (with its origin preserved) so undo-regenerate keeps working; files that
    stop being referenced are deleted from disk.
    """
    seg = svc_get_segment(db, project_id, chapter_id, segment_id)
    chapter = seg.chapter

    ext = filename.rsplit(".", 1)[-1].lower() if "." in (filename or "") else ""
    if ext not in RECORDED_AUDIO_EXTS:
        # Keep the ValueError a clean snake_case machine code (A8 error
        # contract derives `code` from it); log the rejected extension.
        logger.warning(
            "[save_recorded_segment_audio] rejected extension %r for segment %s",
            ext or "unknown", segment_id)
        raise ValueError("unsupported_audio_format")
    if not audio_bytes:
        raise ValueError("empty_audio")

    chapter_title = chapter.name or ""
    project_name = chapter.project.name
    assets.ensure_chapter_layout(
        project_id, chapter_id,
        chapter_title=chapter_title, project_name=project_name,
    )

    existing_audio = seg.audio or {}
    prev_current = existing_audio.get("current", {}) if isinstance(existing_audio, dict) else {}
    prev_rel: str | None = prev_current.get("path")
    prev_duration: float | None = prev_current.get("duration_sec")
    prev_origin: str | None = prev_current.get("origin")

    # Recordings always get a unique filename so the demoted `previous` audio
    # (path stored in DB) keeps pointing at the old file and undo stays real.
    out_ext = "mp3" if (ext != "mp3" and is_ffmpeg_available()) else ext
    unique_name = f"{seg.id}.rec-{uuid.uuid4().hex[:8]}.{out_ext}"
    target = assets.chapter_dir(
        project_id, chapter_id, project_name=project_name,
    ) / "segments" / unique_name
    target.parent.mkdir(parents=True, exist_ok=True)

    if out_ext == "mp3" and ext != "mp3":
        # ffmpeg probes input by content, so webm/ogg/m4a/wav all transcode fine
        transcode_to_mp3(audio_bytes, target)
        audio_format = "mp3"
    else:
        target.write_bytes(audio_bytes)
        audio_format = out_ext
    new_rel = target.relative_to(assets.settings.segmented_dir).as_posix()

    probed: float | None = None
    if is_ffmpeg_available():
        try:
            probed = probe_audio_duration(target)
        except Exception as e:  # noqa: BLE001
            logger.warning("probe_audio_duration failed for %s: %s", new_rel, e)
    if probed is None and audio_format == "wav":
        probed = _duration_from_bytes(audio_bytes, "wav")
    final_duration = probed if probed is not None else duration_sec

    # Drop files the new audio state no longer references (e.g. a previous
    # recording two generations back), then persist.
    new_audio: dict[str, Any] = {"current": {"path": new_rel}}
    if prev_rel:
        new_audio["previous"] = {"path": prev_rel}
    _delete_dropped_audio_files(seg, new_audio)

    update_segment_after_synth(
        db, seg,
        current_audio_path=new_rel,
        previous_audio_path=prev_rel,
        previous_duration_sec=prev_duration,
        audio_format=audio_format,
        duration_sec=final_duration,
        generated_params=seg.generated_params or {},
        current_origin="recorded",
        previous_origin=prev_origin,
    )
    return seg


def export_chapter_audio_mp3(
    db: Session,
    project_id: str,
    chapter_id: str,
    export_directory: str | None = None,
) -> Path:
    """Export all ready backend-stored segment audio in a chapter as one MP3."""
    chapter = get_chapter_row(db, project_id, chapter_id)
    if chapter is None:
        raise LookupError("chapter_not_found")
    if not is_ffmpeg_available():
        raise AudioEncoderError("ffmpeg is required to export mp3")

    input_paths = _collect_chapter_audio_paths(db, chapter)
    export_path = _chapter_audio_export_path(chapter, project_id, chapter_id, export_directory)
    return concat_to_mp3(input_paths, export_path)


def _collect_chapter_audio_paths(db: Session, chapter: SegmentedProjectChapter) -> list[Path]:
    """Ordered absolute paths of the chapter's ready segment audio.

    Segments whose DB-stored path has vanished from disk are flagged
    ``audio.missing`` (and committed); ``no_ready_audio`` when nothing is left.
    """
    input_paths: list[Path] = []
    base = assets.settings.segmented_dir.resolve()
    for seg in sorted(chapter.segments, key=lambda s: s.position):
        audio = seg.audio or {}
        current = audio.get("current", {}) if isinstance(audio, dict) else {}
        current_path = current.get("path")
        if not current_path:
            continue
        abs_path = (assets.settings.segmented_dir / current_path).resolve()
        if not abs_path.is_relative_to(base):
            raise ValueError("invalid_audio_path")
        if abs_path.exists():
            input_paths.append(abs_path)
        else:
            audio = copy.deepcopy(seg.audio or {})
            if isinstance(audio, dict):
                audio["missing"] = True
                seg.audio = audio

    if not input_paths:
        db.commit()
        raise ValueError("no_ready_audio")

    db.commit()
    return input_paths


def _safe_filename_part(value: str) -> str:
    text = (value or "").strip() or "chapter"
    text = re.sub(r"[/\\:*?\"<>|\s]+", "_", text)
    return text.strip("._") or "chapter"


def _chapter_audio_export_path(
    chapter: SegmentedProjectChapter,
    project_id: str,
    chapter_id: str,
    export_directory: str | None = None,
) -> Path:
    project = chapter.project
    title = str(getattr(chapter, "design_title", None) or chapter.name or chapter_id)
    filename = f"{_safe_filename_part(title)}.mp3"
    remotion_path = getattr(project, "remotion_project_path", None)
    if remotion_path:
        root = Path(remotion_path).expanduser()
        if not root.exists() or not root.is_dir():
            root.mkdir(parents=True, exist_ok=True)
        # Resolve export directory relative to remotion project root
        rel_dir = (export_directory or "public/audio").strip("/")
        target_dir = root / rel_dir
        target_dir.mkdir(parents=True, exist_ok=True)
        return target_dir / filename
    return assets.chapter_dir(
        project_id, chapter_id,
        chapter_title=chapter.name or "",
        project_name=project.name,
    ) / "exports" / filename


def copy_file_to_remotion_export_target(
    db: Session,
    project_id: str,
    source_path: Path,
    filename: str,
    export_directory: str | None = None,
) -> Path:
    project = get_project_row(db, project_id)
    if project is None:
        raise LookupError("project_not_found")
    remotion_path = getattr(project, "remotion_project_path", None)
    if not remotion_path:
        raise ValueError("remotion_project_path_not_set")
    root = Path(remotion_path).expanduser()
    if not root.exists() or not root.is_dir():
        root.mkdir(parents=True, exist_ok=True)
    rel_dir = (export_directory or "public/audio").strip("/")
    target_dir = root / rel_dir
    target_dir.mkdir(parents=True, exist_ok=True)
    safe_name = _safe_filename_part(filename.rsplit(".", 1)[0])
    suffix = Path(filename).suffix or source_path.suffix
    target = target_dir / f"{safe_name}{suffix}"
    shutil.copy2(source_path, target)
    return target


# ----- one-click export: all chapters' audio + SRT -----


class ChaptersIncompleteError(ValueError):
    """Raised when any chapter has segments without ready audio.

    Carries the offending chapter display names so the API layer can return
    them to the user. Nothing is written when this is raised.
    """

    def __init__(self, chapters: list[str], missing_counts: dict[str, int] | None = None):
        super().__init__("chapters_incomplete")
        self.chapters = chapters
        # per-chapter count of segments missing audio (name -> count), so the
        # frontend can show "缺 N 段" instead of just a chapter name.
        self.missing_counts = missing_counts or {}


def resolve_export_target_dir(project: SegmentedProject) -> Path:
    """Resolve the project's export target directory.

    Priority:
    1. Absolute (or ~) ``configs.export_directory`` — always wins, no remotion
       project needed.
    2. Relative export_directory (or the ``public/audio`` default) under
       ``remotion_project_path`` — legacy behavior.
    3. Otherwise ``ValueError("export_directory_not_configured")``.
    """
    configs = project.configs if isinstance(project.configs, dict) else {}
    export_dir = str(configs.get("export_directory") or "").strip()
    if export_dir:
        p = Path(export_dir).expanduser()
        if p.is_absolute():
            p.mkdir(parents=True, exist_ok=True)
            return p
    remotion_path = getattr(project, "remotion_project_path", None)
    if remotion_path:
        root = Path(remotion_path).expanduser()
        root.mkdir(parents=True, exist_ok=True)
        rel = (export_dir or "public/audio").strip("/")
        target = root / rel
        target.mkdir(parents=True, exist_ok=True)
        return target
    raise ValueError("export_directory_not_configured")


def _chapter_export_basename(chapter: SegmentedProjectChapter) -> str:
    title = str(getattr(chapter, "design_title", None) or chapter.name or chapter.id)
    return _safe_filename_part(title)


def export_all_chapters(db: Session, project_id: str) -> dict[str, Any]:
    """Export every chapter's concatenated mp3 + chapter-local SRT to the
    project's export directory in one shot.

    Pre-checks ALL chapters first: any segment without an existing
    ``audio.current.path`` file aborts the whole export (nothing written).
    """
    from app.services.srt_service import build_srt

    project = get_project_row(db, project_id)
    if project is None:
        raise LookupError("project_not_found")
    if not is_ffmpeg_available():
        raise AudioEncoderError("ffmpeg is required to export mp3")
    target_dir = resolve_export_target_dir(project)

    chapters = sorted(project.chapters, key=lambda c: c.position)
    base = assets.settings.segmented_dir
    incomplete: list[str] = []
    missing_counts: dict[str, int] = {}
    for ch in chapters:
        name = ch.name or ch.id
        segments = sorted(ch.segments, key=lambda s: s.position)
        missing = 0
        for seg in segments:
            audio = seg.audio or {}
            current = audio.get("current", {}) if isinstance(audio, dict) else {}
            rel = current.get("path")
            if not rel or not (base / rel).exists():
                missing += 1
        # incomplete = any segment missing audio, OR a chapter with no segments
        if missing > 0 or not segments:
            incomplete.append(name)
            missing_counts[name] = missing
    if incomplete:
        raise ChaptersIncompleteError(incomplete, missing_counts)

    exported: list[dict[str, Any]] = []
    for ch in chapters:
        input_paths = _collect_chapter_audio_paths(db, ch)
        basename = _chapter_export_basename(ch)
        audio_path = concat_to_mp3(input_paths, target_dir / f"{basename}.mp3")
        srt_segments = []
        for seg in sorted(ch.segments, key=lambda s: s.position):
            audio = seg.audio or {}
            current = audio.get("current", {}) if isinstance(audio, dict) else {}
            srt_segments.append({
                "text": seg.text,
                "duration_sec": current.get("duration_sec"),
            })
        srt_path = target_dir / f"{basename}.srt"
        srt_path.write_text(build_srt(srt_segments), encoding="utf-8")
        exported.append({
            "chapter_id": ch.id,
            "title": ch.name or ch.id,
            "audio_path": str(audio_path),
            "srt_path": str(srt_path),
        })
    return {"exported": exported, "count": len(exported)}


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
    small files as ``missing=True`` in the audio JSON.

    Idempotent: segments already marked are left alone. The audio file on
    disk is NOT deleted — the user may still want to inspect or recover it.

    Returns a dict with ``scanned``, ``marked``, ``already_missing``,
    ``file_missing`` counts so callers can log progress and tests can assert.
    """
    from app.core.config import settings

    base = Path(base_dir) if base_dir else Path(settings.segmented_dir)

    scanned = marked = already_missing = file_missing = 0

    segs = (
        db.query(SegmentedProjectSegment)
        .all()
    )

    for seg in segs:
        audio_data = dict(seg.audio) if seg.audio else {}
        current = audio_data.get("current", {}) if isinstance(audio_data, dict) else {}
        rel_path = current.get("path")
        if not rel_path:
            continue
        scanned += 1

        if audio_data.get("missing"):
            already_missing += 1
            continue

        abs_path = base / rel_path if not Path(rel_path).is_absolute() else Path(rel_path)
        if not abs_path.exists():
            audio_data["missing"] = True
            seg.audio = audio_data
            marked += 1
            file_missing += 1
            continue

        try:
            size = abs_path.stat().st_size
        except OSError:
            audio_data["missing"] = True
            seg.audio = audio_data
            marked += 1
            file_missing += 1
            continue

        if size < min_size_bytes:
            audio_data["missing"] = True
            seg.audio = audio_data
            marked += 1

    if marked:
        db.flush()
        db.commit()

    return {
        "scanned": scanned,
        "marked": marked,
        "already_missing": already_missing,
        "file_missing": file_missing,
    }


# ----- batch reuse helpers (preserve_audio / split_segments) ---------------

# 纯匹配逻辑（标题规范化/复用索引）在 app.services.batch_reuse——workers 模式
# 的 supabase 仓储也用它，不能留在含 sqlalchemy 的本模块里被直接复用。
from app.services.batch_reuse import build_reuse_index, normalize_chapter_title


def _delete_audio_files_from_snapshot(audio: dict[str, Any]) -> None:
    """按快照里的存储路径删除 current/previous 音频文件（不重建路径）。"""
    for slot in ("current", "previous"):
        entry = audio.get(slot)
        if isinstance(entry, dict) and isinstance(entry.get("path"), str):
            assets.delete_audio_file(entry["path"])


def _move_reused_audio(
    project_id: str,
    chapter_id: str,
    project_name: str | None,
    new_segment_id: str,
    audio: dict[str, Any],
) -> dict[str, Any] | None:
    """把复用的 current 音频文件 move 到新 segment 的规范路径。

    返回更新路径后的 audio dict；文件缺失返回 None（调用方按未复用处理）；
    move 失败保留旧路径（旧文件未 GC，路径仍有效）。
    """
    current = audio.get("current")
    if not isinstance(current, dict) or not isinstance(current.get("path"), str):
        return None
    old_abs = Path(current["path"])
    if not old_abs.is_absolute():
        old_abs = assets.settings.segmented_dir / old_abs
    if not old_abs.exists():
        return None
    fmt = current.get("format") or audio.get("format") or old_abs.suffix.lstrip(".") or "mp3"
    new_abs = assets.segment_audio_path(
        project_id, chapter_id,
        project_name=project_name, segment_id=new_segment_id, fmt=fmt,
    )
    new_abs.parent.mkdir(parents=True, exist_ok=True)
    try:
        os.replace(old_abs, new_abs)
    except OSError:
        try:
            shutil.move(str(old_abs), str(new_abs))
        except OSError:
            logger.warning("reuse audio move failed, keep old path: %s", old_abs)
            return audio
    current["path"] = new_abs.relative_to(assets.settings.segmented_dir).as_posix()
    return audio


def batch_create_structure(
    db: Session,
    project_id: str,
    chapters: list[dict[str, Any]],
    narration_script: str | None = None,
    *,
    preserve_audio: bool = False,
    split_segments: bool = False,
) -> dict[str, Any]:
    """Replace all chapters+segments of a project in one transaction.

    Resolves default voice from the project's first existing chapter
    (or edge_tts default), deletes existing chapters, creates the new
    structure, and returns ``{"chapters": [...assigned ids...], "reuse": report|None}``.
    ``narration_script``（workflow 产出的完整旁白稿）写入项目级字段；None 表示不更新。

    ``preserve_audio``：重拆前快照旧章节（按规范化标题匹配），新 segment 文本
    与旧 segment 一致时沿承其 audio/generated_params/emotion/role_id/voice，
    并把音频文件 move 到新规范路径；未被复用的旧音频文件在重建后 GC。
    ``split_segments``：payload 章节未自带 segments 时，按该章最终 split_config
    的 delimiters 用 rule_split 直接拆分（mode=="llm" 的章节在此同样走规则
    拆分——批量场景不做逐章 LLM 调用）。
    """
    project = db.query(SegmentedProject).filter_by(id=project_id).first()
    if project is None:
        raise LookupError("project_not_found")

    if narration_script is not None:
        project.narration_document_path = assets.write_project_document(
            project_id, kind="narration",
            project_name=project.name, text=narration_script,
        )

    # 删除前快照旧结构（标题匹配键 -> 章节快照），供沿承/复用
    old_index: dict[str, dict[str, Any]] = {}
    if preserve_audio or split_segments:
        old_index = build_reuse_index(
            [
                {
                    "name": ch.name,
                    "voice": ch.voice,
                    "split_config": ch.split_config,
                    "segments": [
                        {
                            "text": s.text,
                            "emotion": s.emotion,
                            "role_id": s.role_id,
                            "voice": s.voice,
                            "audio": s.audio,
                            "generated_params": s.generated_params,
                            "generated_at": s.generated_at,
                        }
                        for s in ch.segments
                    ],
                }
                for ch in project.chapters
            ]
        )

    # default voice: from first existing chapter, or edge_tts default
    default_voice = {"engine": "edge_tts", "voice": "zh-CN-YunxiNeural", "rate": "+0%", "volume": "+0%"}
    if project.chapters:
        ch_voice = project.chapters[0].voice or {}
        if ch_voice.get("voice") and ch_voice.get("engine") == "edge_tts":
            default_voice = ch_voice
        elif ch_voice.get("voice_id") and ch_voice.get("engine") in ("cosyvoice", "mimo_tts", "voxcpm"):
            default_voice = ch_voice

    # delete existing chapters (cascade deletes segments). preserve_audio 时
    # 音频文件延迟清理：重建匹配完成后只删未被复用的（复用的已 move 走）。
    for ch in list(project.chapters):
        if not preserve_audio:
            for seg in list(ch.segments):
                _delete_segment_audio_files(seg)
        db.delete(ch)
    db.flush()

    from app.services.text_split_service import rule_split

    chapters_matched = 0
    segments_matched = 0
    segments_reused = 0
    segments_new = 0
    per_chapter: list[dict[str, Any]] = []

    result = []
    for index, ch_data in enumerate(chapters):
        title = ch_data.get("chapter_title", f"Chapter {index + 1}")
        snapshot = old_index.get(normalize_chapter_title(title))

        # 章节级沿承：匹配章节的 voice/split_config 优先于默认；payload 显式
        # split_config 最优先。
        base_voice = copy.deepcopy(snapshot["voice"]) if snapshot and snapshot["voice"] else default_voice
        chapter = create_chapter_for_project(db, project_id, title, index, voice=base_voice)
        if ch_data.get("split_config"):
            chapter.split_config = copy.deepcopy(ch_data["split_config"])
        elif snapshot and snapshot["split_config"]:
            chapter.split_config = copy.deepcopy(snapshot["split_config"])
        chapter.narration_script = ch_data.get("narration_script")
        chapter.original_text = ch_data.get("original_text")
        engine = ch_data.get("engine")
        if engine:
            voice = dict(chapter.voice or {})
            voice["engine"] = engine
            chapter.voice = voice

        seg_payloads = ch_data.get("segments") or []
        if split_segments and not seg_payloads:
            body = ch_data.get("narration_script") or ch_data.get("original_text") or ""
            delimiters = (chapter.split_config or {}).get(
                "delimiters", ["，", "。", "！", "？", "；"]
            )
            seg_payloads = [{"text": t} for t in rule_split(body, delimiters)]

        if snapshot:
            chapters_matched += 1
        ch_matched = 0
        ch_reused = 0

        seg_result = []
        for seg_data in seg_payloads:
            seg = create_segment_for_chapter(
                db, chapter.id, seg_data["text"], len(seg_result),
                emotion=seg_data.get("emotion"), role=seg_data.get("role"),
                segment_kind=seg_data.get("segment_kind", "narration"),
            )
            matched = None
            if preserve_audio and snapshot is not None:
                pool = snapshot["segments"].get((seg_data["text"] or "").strip())
                if pool:
                    matched = pool.popleft()
            if matched is not None:
                ch_matched += 1
                if seg.emotion is None and matched["emotion"]:
                    seg.emotion = matched["emotion"]
                if seg.role_id is None and matched["role_id"]:
                    seg.role_id = matched["role_id"]
                if matched["voice"]:
                    seg.voice = copy.deepcopy(matched["voice"])
                if matched["audio"]:
                    moved = _move_reused_audio(
                        project_id, chapter.id, project.name, seg.id,
                        copy.deepcopy(matched["audio"]),
                    )
                    if moved is not None:
                        seg.audio = moved
                        if matched["generated_params"]:
                            seg.generated_params = copy.deepcopy(matched["generated_params"])
                        if matched["generated_at"] is not None:
                            seg.generated_at = matched["generated_at"]
                        ch_reused += 1
            seg_result.append({"id": seg.id})

        segments_matched += ch_matched
        segments_reused += ch_reused
        ch_new = len(seg_result) - ch_reused
        segments_new += ch_new
        per_chapter.append(
            {
                "chapter_id": chapter.id,
                "title": title,
                "matched": ch_matched,
                "reused": ch_reused,
                "new": ch_new,
            }
        )

        # layer-sync: this chapter is freshly derived (L2 from L1) and split
        # (L3 from L2) in one go -> snapshot all three hashes as the baseline.
        from app.services.layer_sync_service import mark_consistent
        mark_consistent(chapter)
        result.append({"id": chapter.id, "segments": seg_result})

    # GC：未被复用的旧 segment 音频文件（复用的 current 已 move 走）
    if preserve_audio:
        for snap in old_index.values():
            for pool in snap["segments"].values():
                for leftover in pool:
                    if leftover["audio"]:
                        _delete_audio_files_from_snapshot(leftover["audio"])

    db.commit()
    reuse_report = None
    if preserve_audio or split_segments:
        reuse_report = {
            "chapters_matched": chapters_matched,
            "segments_matched": segments_matched,
            "segments_reused": segments_reused,
            "segments_new": segments_new,
            "per_chapter": per_chapter,
        }
    return {"chapters": result, "reuse": reuse_report}


def adjust_chapter_audio(
    db: Session,
    project_id: str,
    chapter_id: str,
    *,
    tempo: float = 1.0,
    volume_db: float = 0.0,
) -> dict[str, Any]:
    """Post-synthesis adjustment: apply atempo/volume to all ready segments
    of a chapter with ffmpeg.

    Absolute semantics: the chapter keeps an ``audio_adjust`` record of the
    currently applied params. Re-adjusting always renders from the ORIGINAL
    audio (stashed in ``audio.previous`` on first adjust) — never cascades
    on top of already-processed audio. Applying identity (1.0x / 0dB) with
    a record present reverts to the original and clears the record.

    Segments whose current audio is a user recording (``origin == "recorded"``)
    are exempt: they are never re-rendered or overwritten, and identity revert
    skips them too. The result reports them via ``skipped_recorded``.
    """
    if not 0.5 <= tempo <= 2.0:
        raise ValueError("tempo_out_of_range")
    if not -12.0 <= volume_db <= 12.0:
        raise ValueError("volume_db_out_of_range")
    if not is_ffmpeg_available():
        raise ValueError("ffmpeg_unavailable")

    chapter = get_chapter_row(db, project_id, chapter_id)
    if chapter is None:
        raise LookupError("chapter_not_found")

    record = getattr(chapter, "audio_adjust", None)
    identity = abs(tempo - 1.0) < 1e-9 and abs(volume_db) < 1e-9
    if identity and not record:
        raise ValueError("no_adjustment")

    root = assets.settings.segmented_dir
    adjusted = 0
    skipped_recorded = 0
    # SAVEPOINT：任何一段处理失败（如 probe 返回 None）都整体回滚本次
    # adjust 的行改动，不落半完成状态（不能用 db.rollback()，那会连带
    # 回滚调用方在同一外部事务里已提交的数据）。
    with db.begin_nested():
        for seg in chapter.segments:
            audio = seg.audio if isinstance(seg.audio, dict) else None
            if not audio:
                continue
            cur = audio.get("current") or {}
            prev = audio.get("previous") or {}
            cur_rel = cur.get("path") if isinstance(cur, dict) else None
            prev_rel = prev.get("path") if isinstance(prev, dict) else None
            if not isinstance(cur_rel, str) or not cur_rel:
                continue
            # 录音段豁免 chapter 变速：不渲染、不覆盖，恒等还原同样跳过，
            # 否则旧 TTS 变速版会盖掉用户录音（数据丢失）。
            if cur.get("origin") == "recorded":
                skipped_recorded += 1
                continue

            def _abs(rel: str) -> Path:
                p = Path(rel)
                return p if p.is_absolute() else root / p

            # Base: original audio — the stashed previous once a record exists,
            # otherwise the current file (first adjust).
            base_rel = prev_rel if (record and isinstance(prev_rel, str) and prev_rel) else cur_rel
            base_abs = _abs(base_rel)
            cur_abs = _abs(cur_rel)
            if not base_abs.exists():
                continue

            fmt = cur.get("format") or cur_abs.suffix.lstrip(".") or "mp3"
            updated = copy.deepcopy(audio)

            if identity:
                # Revert: current becomes a copy of the original.
                shutil.copy2(base_abs, cur_abs)
            else:
                if not record:
                    # First adjust: stash the original as previous (overwrites any
                    # prior previous — adjust undo supersedes regen undo).
                    prev_abs = cur_abs.with_name(f"{seg.id}.prev.{fmt}")
                    shutil.copy2(cur_abs, prev_abs)
                    try:
                        new_prev_rel = prev_abs.relative_to(root).as_posix()
                    except ValueError:
                        new_prev_rel = str(prev_abs)
                    prev_entry: dict[str, Any] = {"path": new_prev_rel}
                    if cur.get("duration_sec") is not None:
                        prev_entry["duration_sec"] = cur["duration_sec"]
                    updated["previous"] = prev_entry
                    base_abs = prev_abs
                adjust_audio_speed_volume(base_abs, cur_abs, tempo=tempo, volume_db=volume_db)

            new_duration = probe_audio_duration(cur_abs)
            if new_duration is None:
                # probe 失败不能吞成 None（SRT 会按 0s 处理）：抛错中止，
                # SAVEPOINT 回滚本次 adjust 已改动的行。
                raise AudioEncoderError(f"probe_failed: {cur_rel}")
            updated["current"]["duration_sec"] = new_duration
            # 顶层 duration_sec 是时间轴/SRT/章节时长的读取源，必须同步
            updated["duration_sec"] = new_duration
            seg.audio = updated
            seg.updated_at = utcnow()
            adjusted += 1

        if adjusted > 0 or identity:
            chapter.audio_adjust = None if identity else {
                "tempo": tempo,
                "volume_db": volume_db,
                "applied_at": utcnow().isoformat(),
                "segments": adjusted,
            }
        chapter.updated_at = utcnow()
        chapter.project.updated_at = utcnow()
    db.commit()
    return {
        "adjusted": adjusted,
        "skipped_recorded": skipped_recorded,
        "project": get_project_detail(db, project_id),
    }


def adjust_all_chapters_audio(
    db: Session,
    project_id: str,
    *,
    tempo: float = 1.0,
    volume_db: float = 0.0,
) -> dict[str, Any]:
    """Apply post-synthesis tempo/volume adjust to ALL chapters' ready segments.

    Reuses :func:`adjust_chapter_audio` per chapter — identical absolute
    semantics and identical duration recomputation (top-level ``duration_sec``
    is re-probed so the timeline/SRT/chapter timing stays correct). Chapters
    that have no ready segments and no existing adjust record are skipped
    (``adjust_chapter_audio`` raises ``no_adjustment`` for them).
    """
    if not 0.5 <= tempo <= 2.0:
        raise ValueError("tempo_out_of_range")
    if not -12.0 <= volume_db <= 12.0:
        raise ValueError("volume_db_out_of_range")
    if not is_ffmpeg_available():
        raise ValueError("ffmpeg_unavailable")

    project = get_project_row(db, project_id)
    if project is None:
        raise LookupError("project_not_found")

    chapters = list(project.chapters)
    total_adjusted = 0
    total_skipped_recorded = 0
    chapters_processed = 0
    chapters_skipped = 0
    for ch in chapters:
        try:
            res = adjust_chapter_audio(db, project_id, ch.id, tempo=tempo, volume_db=volume_db)
        except ValueError:
            # no_adjustment: chapter has no ready segments and no existing record
            chapters_skipped += 1
            continue
        total_adjusted += res.get("adjusted", 0)
        total_skipped_recorded += res.get("skipped_recorded", 0)
        chapters_processed += 1
    return {
        "adjusted": total_adjusted,
        "skipped_recorded": total_skipped_recorded,
        "chapters_processed": chapters_processed,
        "chapters_skipped": chapters_skipped,
    }


def resplit_from_script(db: Session, project_id: str, chapter_id: str):
    """Layer-sync Phase B: re-split segments from the chapter's current L2.

    Discards all existing segments (role/emotion/voice config lost) and
    regenerates them via ``rule_split`` on ``chapter.narration_script``.
    Re-baselines L2/L3 (+ split_anchor). Returns the refreshed ProjectDetail.
    """
    from uuid import uuid4

    from app.services.layer_sync_service import mark_split
    from app.services.text_split_service import rule_split

    chapter = get_chapter_row(db, project_id, chapter_id)
    if chapter is None:
        raise LookupError("chapter_not_found")
    delimiters = (chapter.split_config or {}).get("delimiters", ["，", "。", "！", "？", "；"])
    items = rule_split(chapter.narration_script or "", delimiters)
    for s in list(chapter.segments):
        db.delete(s)
    db.flush()
    for i, text in enumerate(items):
        db.add(SegmentedProjectSegment(
            id=str(uuid4()), chapter_id=chapter.id, position=i, text=text,
            segment_kind="narration", voice={"source": "chapter"},
        ))
    db.flush()
    db.refresh(chapter)
    mark_split(chapter)
    db.commit()
    return get_project_detail(db, project_id)


def create_chapter_for_project(
    db: Session,
    project_id: str,
    chapter_name: str,
    position: int,
    voice: dict[str, Any] | None = None,
) -> SegmentedProjectChapter:
    """Create a new chapter under an existing project.

    Returns the persisted ``SegmentedProjectChapter`` ORM instance.
    The caller is responsible for committing the session.
    """
    from uuid import uuid4

    project = db.query(SegmentedProject).filter_by(id=project_id).first()
    if project is None:
        raise LookupError(f"project_not_found: {project_id}")

    chapter = SegmentedProjectChapter(
        id=str(uuid4()),
        project_id=project_id,
        position=position,
        name=chapter_name,
        voice=voice or {},
        split_config={"delimiters": ["，", "。", "！", "？", "；"], "mode": "rule"},
    )
    db.add(chapter)
    db.flush()
    return chapter


def create_segment_for_chapter(
    db: Session,
    chapter_id: str,
    text: str,
    position: int,
    *,
    emotion: str | None = None,
    role: str | None = None,
    segment_kind: str = "narration",
) -> SegmentedProjectSegment:
    """Create a new segment under an existing chapter.

    Returns the persisted ``SegmentedProjectSegment`` ORM instance.
    The caller is responsible for committing the session.
    """
    from uuid import uuid4

    segment = SegmentedProjectSegment(
        id=str(uuid4()),
        chapter_id=chapter_id,
        position=position,
        text=text,
        emotion=emotion,
        segment_kind=segment_kind,
    )
    db.add(segment)
    db.flush()
    return segment
