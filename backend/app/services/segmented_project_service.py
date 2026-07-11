"""Business logic for segmented project CRUD and asset mirroring."""
from __future__ import annotations

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
        flat["edge_voice"] = voice.get("voice", "")
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
                design_title=getattr(ch, "design_title", None),
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
        source_document=getattr(p, "source_document", None),
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
    p.source_document = project.source_document
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
        setattr(ch, "design_title", ch_in.design_title)
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
                # Clean up audio files from disk before removing the DB row
                if seg.audio:
                    try:
                        audio_data = seg.audio if isinstance(seg.audio, dict) else json.loads(seg.audio)
                        current = audio_data.get('current')
                        if current and isinstance(current, dict):
                            fmt = current.get('format', 'mp3')
                            assets.remove_segment_audio(project.id, ch.id, seg.id, fmt)
                        # Also handle 'previous' audio for re-generation scenarios
                        previous = audio_data.get('previous')
                        if previous and isinstance(previous, dict) and isinstance(previous.get('path'), str):
                            prev_path_str = previous['path']
                            try:
                                prev_path = Path(prev_path_str)
                                if not prev_path.is_absolute():
                                    prev_path = assets.settings.segmented_dir / prev_path
                                if prev_path.exists():
                                    prev_path.unlink()
                            except (OSError, Exception):
                                pass
                    except Exception:
                        pass
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
    assets.write_manifest(p.id, project_to_detail(p).model_dump(mode="json"))


def delete_project(db: Session, project_id: str) -> bool:
    p = db.query(SegmentedProject).filter_by(id=project_id).first()
    if p is None:
        return False
    # 显式清理源 (FK CASCADE 在 SQLite 默认未启用, 不能依赖)
    from app.models.source_document import SourceDocument
    db.query(SourceDocument).filter_by(project_id=project_id).delete(synchronize_session=False)
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
    assets.write_segment_text(seg.project_id, seg.chapter_id, seg.id, seg.text or "")
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

    if not is_ffmpeg_available():
        logger.warning("ffmpeg unavailable; writing wav fallback for segment %s", seg.id)

    audio_bytes, _native_fmt = synthesize_with_engine(text_to_speak, sp, db=db)
    assets.ensure_project_layout(project_id, chapter_id)

    existing_audio = seg.audio or {}
    prev_current = existing_audio.get("current", {}) if isinstance(existing_audio, dict) else {}
    prev_rel: str | None = prev_current.get("path")
    prev_duration: float | None = prev_current.get("duration_sec")

    if is_ffmpeg_available():
        target_mp3 = assets.segment_audio_path(project_id, chapter_id, seg.id, "mp3")
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
        wav_path = assets.segment_audio_path(project_id, chapter_id, seg.id, "wav")
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
    return assets.chapter_dir(project_id, chapter_id) / "exports" / filename


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
