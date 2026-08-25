"""Project export: bundle a project's DB rows + assets into a self-contained ZIP.

The ZIP is portable across NarraForge instances. ``manifest.json`` is the
source of truth (DB row snapshot + rewritten bundle-relative asset paths);
``assets/`` holds the binary files; ``text/`` holds human-readable doc copies.

Export is non-destructive: the source project and its files are never modified.
"""
from __future__ import annotations

import io
import json
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.role import Role
from app.models.segmented_project import SegmentedProject
from app.models.source_document import SourceDocument
from app.models.voice_profile import VoiceProfile

BUNDLE_VERSION = 1

_ILLEGAL_FN_CHARS = '<>:"/\\|?*\x00-\x1f'


def export_project(db: Session, project_id: str) -> tuple[bytes, str]:
    """Export a project to a self-contained ZIP. Returns (zip_bytes, filename)."""
    project = db.query(SegmentedProject).filter_by(id=project_id).first()
    if project is None:
        raise LookupError("project_not_found")

    _assert_assets_under_project_dir(project)

    files: dict[str, bytes] = {}
    manifest = _build_manifest(db, project, files)
    zip_bytes = _pack_zip(manifest, files)
    filename = f"{_safe_filename(project.name or 'project')}.narraforge.zip"
    return zip_bytes, filename


# ── manifest ──────────────────────────────────────────────────────────────


def _build_manifest(db: Session, project: SegmentedProject, files: dict[str, bytes]) -> dict:
    roles = db.query(Role).filter_by(project_id=project.id).all()
    voice_profiles = db.query(VoiceProfile).filter_by(project_id=project.id).all()
    source_docs = db.query(SourceDocument).filter_by(project_id=project.id).all()

    chapters = [_chapter_row(c) for c in project.chapters]
    segments = [_segment_row(s, files) for s in _iter_segments(project)]

    return {
        "bundle_version": BUNDLE_VERSION,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "project": _project_row(project, files),
        "chapters": chapters,
        "segments": segments,
        "roles": [_role_row(r) for r in roles],
        "voice_profiles": [_voice_profile_row(vp, files) for vp in voice_profiles],
        "source_documents": [_source_document_row(d) for d in source_docs],
    }


def _project_row(p: SegmentedProject, files: dict[str, bytes]) -> dict:
    row = {
        "name": p.name,
        "schema_version": p.schema_version,
        "layout": p.layout,
        "original_text": p.original_text,
        "animation_theme": getattr(p, "animation_theme", None),
        "configs": p.configs,
        "active_chapter_id": p.active_chapter_id,
        "default_narrator_role_id": getattr(p, "default_narrator_role_id", None),
        # remotion_project_path intentionally excluded (not portable)
    }
    src_path = getattr(p, "source_document_path", None)
    if src_path and Path(src_path).exists():
        files["text/source.md"] = Path(src_path).read_bytes()
        row["source_document"] = "text/source.md"
    nar_path = getattr(p, "narration_document_path", None)
    if nar_path and Path(nar_path).exists():
        files["text/narration.md"] = Path(nar_path).read_bytes()
        row["narration_document"] = "text/narration.md"
    return row


def _chapter_row(ch) -> dict:
    return {
        "id": ch.id,
        "position": ch.position,
        "name": ch.name,
        "design_title": getattr(ch, "design_title", None),
        "voice": ch.voice or {},
        "split_config": ch.split_config or {},
        "original_text": ch.original_text,
        "narration_script": ch.narration_script,
    }


def _segment_row(seg, files: dict[str, bytes]) -> dict:
    return {
        "id": seg.id,
        "chapter_id": seg.chapter_id,
        "position": seg.position,
        "text": seg.text,
        "emotion": seg.emotion,
        "role_id": seg.role_id,
        "segment_kind": seg.segment_kind,
        "voice": seg.voice or {},
        "generated_params": seg.generated_params,
        "text_transforms": getattr(seg, "text_transforms", None),
        "generated_at": seg.generated_at.isoformat() if seg.generated_at else None,
        "animation_spec_json": seg.animation_spec_json,
        "audio": _rewrite_segment_audio(seg, files),
    }


def _role_row(r: Role) -> dict:
    return {
        "id": r.id,
        "name": r.name,
        "avatar": r.avatar,
        "description": r.description,
        "role_kind": r.role_kind,
        "voice": r.voice or {},
        "favorite_styles": r.favorite_styles or [],
    }


def _voice_profile_row(vp: VoiceProfile, files: dict[str, bytes]) -> dict:
    preview = dict(vp.preview or {})
    rel = preview.get("preview_audio_path")
    if rel:
        src = Path(rel)
        if not src.is_absolute():
            src = settings.base_dir / rel
        if src.exists():
            ext = src.suffix.lstrip(".") or "mp3"
            bundle = f"assets/voices/{vp.id}.{ext}"
            files[bundle] = src.read_bytes()
            preview["preview_audio_path"] = bundle
    return {
        "id": vp.id,
        "name": vp.name,
        "description": vp.description,
        "avatar": vp.avatar,
        "voice": vp.voice or {},
        "voice_params": vp.voice_params or {},
        "preview": preview,
    }


def _source_document_row(d: SourceDocument) -> dict:
    return {
        "id": d.id,
        "source_type": d.source_type,
        "title": d.title,
        "file_path": d.file_path,
        "pasted_text": d.pasted_text,
        "audio_path": d.audio_path,
        "file_size": d.file_size,
        "duration_sec": d.duration_sec,
    }


# ── asset collection ──────────────────────────────────────────────────────


def _iter_segments(project: SegmentedProject):
    for ch in sorted(project.chapters, key=lambda c: c.position):
        for seg in sorted(ch.segments, key=lambda s: s.position):
            yield seg


def _rewrite_segment_audio(seg, files: dict[str, bytes]) -> dict | None:
    if not seg.audio:
        return None
    audio = json.loads(json.dumps(seg.audio))  # deep copy, leave original untouched
    cur_src = (audio.get("current") or {}).get("path")
    prev_src = (audio.get("previous") or {}).get("path")

    if cur_src:
        content = _try_read_segment_file(cur_src)
        if content is None:
            audio["current"]["missing"] = True
        else:
            bundle = f"assets/segments/{seg.id}.{_ext(audio.get('current'), cur_src)}"
            files[bundle] = content
            audio["current"]["path"] = bundle
    if prev_src:
        if prev_src == cur_src:
            audio["previous"]["path"] = audio["current"].get("path")
            if audio["current"].get("missing"):
                audio["previous"]["missing"] = True
        else:
            content = _try_read_segment_file(prev_src)
            if content is None:
                audio["previous"]["missing"] = True
            else:
                bundle = f"assets/segments/{seg.id}.prev.{_ext(audio.get('previous'), prev_src)}"
                files[bundle] = content
                audio["previous"]["path"] = bundle
    return audio


def _ext(entry: dict | None, path: str) -> str:
    if entry and entry.get("format"):
        return entry["format"]
    return Path(path).suffix.lstrip(".") or "mp3"


def _read_segment_file(rel_path: str) -> bytes:
    return (settings.segmented_dir / rel_path).read_bytes()


def _try_read_segment_file(rel_path: str) -> bytes | None:
    try:
        return _read_segment_file(rel_path)
    except (FileNotFoundError, NotADirectoryError):
        return None


# ── guard ─────────────────────────────────────────────────────────────────


def _assert_assets_under_project_dir(project: SegmentedProject) -> None:
    """Refuse export when any segment audio / project doc lives outside the
    backend workspace (base_dir). Paths in ANY historical layout under the
    workspace are fine — the bundler reads DB-stored paths, not dir names;
    missing files are skipped, never fatal."""
    from app.core import segmented_assets as assets

    root = settings.segmented_dir.resolve()
    workspace = settings.base_dir.resolve()

    def _under(rel_or_abs: str | None) -> None:
        if not rel_or_abs:
            return
        p = Path(rel_or_abs)
        if not p.is_absolute():
            p = root / p
        resolved = Path(p).resolve()
        for allowed in (root, workspace):
            try:
                resolved.relative_to(allowed)
                return
            except ValueError:
                continue
        raise ValueError("project_assets_not_under_project_dir")

    for seg in _iter_segments(project):
        audio = seg.audio or {}
        for slot in ("current", "previous"):
            entry = audio.get(slot) if isinstance(audio, dict) else None
            if entry and isinstance(entry, dict):
                _under(entry.get("path"))

    for attr in ("source_document_path", "narration_document_path"):
        _under(getattr(project, attr, None))


# ── packing ───────────────────────────────────────────────────────────────


def _pack_zip(manifest: dict, files: dict[str, bytes]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))
        for path, data in files.items():
            z.writestr(path, data)
    return buf.getvalue()


def _safe_filename(name: str) -> str:
    cleaned = "".join("_" if c in _ILLEGAL_FN_CHARS else c for c in name).strip(" .")
    return cleaned or "project"
