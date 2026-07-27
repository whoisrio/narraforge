"""Business logic for segmented project CRUD and asset mirroring."""
from __future__ import annotations

import copy
import json
import logging
import os
import re
import shutil
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
                audio=getattr(s, "audio", None),
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
    if project.created_at:
        p.created_at = _parse_iso(project.created_at)
    p.updated_at = utcnow()

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
        ch.voice = ch_in.voice or {}
        ch.split_config = ch_in.split_config or {}
        ch.original_text = ch_in.original_text
        setattr(ch, "narration_script", ch_in.narration_script)
        setattr(ch, "design_title", ch_in.design_title)
        # audio_adjust 由 adjust-audio 端点维护；payload 未携带时保留原值
        if ch_in.audio_adjust is not None:
            setattr(ch, "audio_adjust", ch_in.audio_adjust)
        if ch_in.created_at:
            ch.created_at = _parse_iso(ch_in.created_at)
        ch.updated_at = utcnow()
        keep_chapter_ids.add(ch_in.id)

        # Segments
        existing_segments = {s.id: s for s in ch.segments}
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
) -> None:
    audio_data = {
        "format": audio_format,
        "current": {"path": current_audio_path, "format": audio_format},
    }
    if duration_sec is not None:
        audio_data["current"]["duration_sec"] = duration_sec
    if previous_audio_path:
        prev_entry: dict[str, Any] = {"path": previous_audio_path}
        if previous_duration_sec is not None:
            prev_entry["duration_sec"] = previous_duration_sec
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
) -> SegmentedProjectSegment:
    seg = svc_get_segment(db, project_id, chapter_id, segment_id)
    chapter = seg.chapter

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
    text_to_speak = prepare_text_for_engine(
        text_to_speak,
        engine=sp.engine,
        emotion=getattr(seg, "emotion", None),
        style=style,
        voxcpm_mode=sp.voxcpm_mode if sp.engine == "voxcpm" else None,
        mute_tags=bool(sp.mute_tags),
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
        previous_duration_sec=prev_duration,
        audio_format=audio_format,
        duration_sec=duration_sec,
        generated_params=effective,
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
            audio["missing"] = True
            seg.audio = audio

    if not input_paths:
        db.commit()
        raise ValueError("no_ready_audio")

    db.commit()
    export_path = _chapter_audio_export_path(chapter, project_id, chapter_id, export_directory)
    return concat_to_mp3(input_paths, export_path)


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


def batch_create_structure(
    db: Session,
    project_id: str,
    chapters: list[dict[str, Any]],
    narration_script: str | None = None,
) -> list[dict[str, Any]]:
    """Replace all chapters+segments of a project in one transaction.

    Resolves default voice from the project's first existing chapter
    (or edge_tts default), deletes existing chapters, creates the new
    structure, and returns assigned ids. ``narration_script``（workflow 产出
    的完整旁白稿）写入项目级字段；None 表示不更新。
    """
    project = db.query(SegmentedProject).filter_by(id=project_id).first()
    if project is None:
        raise LookupError("project_not_found")

    if narration_script is not None:
        project.narration_document_path = assets.write_project_document(
            project_id, kind="narration",
            project_name=project.name, text=narration_script,
        )

    # default voice: from first existing chapter, or edge_tts default
    default_voice = {"engine": "edge_tts", "voice": "zh-CN-YunxiNeural", "rate": "+0%", "volume": "+0%"}
    if project.chapters:
        ch_voice = project.chapters[0].voice or {}
        if ch_voice.get("voice") and ch_voice.get("engine") == "edge_tts":
            default_voice = ch_voice
        elif ch_voice.get("voice_id") and ch_voice.get("engine") in ("cosyvoice", "mimo_tts", "voxcpm"):
            default_voice = ch_voice

    # delete existing chapters (cascade deletes segments) and clean up their
    # generated audio files on disk so re-splitting does not orphan assets.
    for ch in list(project.chapters):
        for seg in list(ch.segments):
            _delete_segment_audio_files(seg)
        db.delete(ch)
    db.flush()

    result = []
    for index, ch_data in enumerate(chapters):
        title = ch_data.get("chapter_title", f"Chapter {index + 1}")
        chapter = create_chapter_for_project(db, project_id, title, index, voice=default_voice)
        chapter.narration_script = ch_data.get("narration_script")
        chapter.original_text = ch_data.get("original_text")
        engine = ch_data.get("engine")
        if engine:
            voice = dict(chapter.voice or {})
            voice["engine"] = engine
            chapter.voice = voice
        seg_result = []
        for seg_data in ch_data.get("segments", []):
            seg = create_segment_for_chapter(
                db, chapter.id, seg_data["text"], len(seg_result),
                emotion=seg_data.get("emotion"), role=seg_data.get("role"),
                segment_kind=seg_data.get("segment_kind", "narration"),
            )
            seg_result.append({"id": seg.id})
        # layer-sync: this chapter is freshly derived (L2 from L1) and split
        # (L3 from L2) in one go -> snapshot all three hashes as the baseline.
        from app.services.layer_sync_service import mark_consistent
        mark_consistent(chapter)
        result.append({"id": chapter.id, "segments": seg_result})
    db.commit()
    return result


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
    return {"adjusted": adjusted, "project": get_project_detail(db, project_id)}


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
