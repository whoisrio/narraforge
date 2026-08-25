"""Project import: recreate a project from an export ZIP bundle.

Creates a NEW project with freshly generated IDs (nothing is overwritten).
All FK references (chapter.project_id, segment.chapter_id, segment.role_id,
project.active_chapter_id / default_narrator_role_id) are remapped to the new
IDs. Asset files are written to the target filesystem and DB path fields are
rewritten to the new locations.
"""
from __future__ import annotations

import io
import json
import zipfile
from datetime import datetime
from pathlib import Path
from uuid import uuid4

from sqlalchemy.orm import Session

from app.core import segmented_assets as assets
from app.core.config import settings
from app.models.role import Role
from app.models.segmented_project import (
    SegmentedProject,
    SegmentedProjectChapter,
    SegmentedProjectSegment,
)
from app.models.source_document import SourceDocument
from app.models.voice_profile import VoiceProfile
from app.services.project_export_service import BUNDLE_VERSION
from app.services.segmented_project_service import project_to_detail


def import_project(db: Session, zip_bytes: bytes):
    """Import a project from a ZIP bundle. Returns the new ProjectDetail."""
    manifest, files = _read_bundle(zip_bytes)
    _assert_bundle_version(manifest)

    new_pid = str(uuid4())
    chapter_map = {c["id"]: str(uuid4()) for c in manifest["chapters"]}
    segment_map = {s["id"]: str(uuid4()) for s in manifest["segments"]}
    role_map = {r["id"]: str(uuid4()) for r in manifest["roles"]}
    voice_map = {v["id"]: str(uuid4()) for v in manifest["voice_profiles"]}
    source_map = {d["id"]: str(uuid4()) for d in manifest["source_documents"]}

    proj_data = manifest["project"]
    project = SegmentedProject(
        id=new_pid,
        name=proj_data["name"],
        schema_version=proj_data.get("schema_version", 2),
        layout=proj_data.get("layout", "vertical"),
        original_text=proj_data.get("original_text"),
        animation_theme=proj_data.get("animation_theme"),
        configs=proj_data.get("configs") or {},
        active_chapter_id=chapter_map.get(proj_data.get("active_chapter_id")),
        default_narrator_role_id=role_map.get(proj_data.get("default_narrator_role_id")),
        remotion_project_path=None,  # not portable; reset on import
    )
    db.add(project)

    # roles (before segments so segment.role_id FK is satisfiable)
    for r in manifest["roles"]:
        db.add(Role(
            id=role_map[r["id"]], name=r["name"], project_id=new_pid,
            avatar=r.get("avatar"), description=r.get("description"),
            role_kind=r.get("role_kind", "cast"),
            voice=r.get("voice") or {}, favorite_styles=r.get("favorite_styles") or [],
        ))

    # chapters
    chapter_title_by_new = {}
    for c in manifest["chapters"]:
        new_cid = chapter_map[c["id"]]
        chapter_title_by_new[new_cid] = c["name"]
        db.add(SegmentedProjectChapter(
            id=new_cid, project_id=new_pid, position=c["position"], name=c["name"],
            design_title=c.get("design_title"), voice=c.get("voice") or {},
            split_config=c.get("split_config") or {},
            original_text=c.get("original_text"), narration_script=c.get("narration_script"),
        ))

    # segments (+ audio files written to new paths)
    for s in manifest["segments"]:
        new_sid = segment_map[s["id"]]
        new_cid = chapter_map[s["chapter_id"]]
        audio = _rewrite_segment_audio_for_import(s, new_pid, new_cid, new_sid,
                                                   chapter_title_by_new[new_cid],
                                                   proj_data["name"], files)
        db.add(SegmentedProjectSegment(
            id=new_sid, chapter_id=new_cid, position=s["position"], text=s["text"],
            emotion=s.get("emotion"),
            role_id=role_map.get(s.get("role_id")),
            segment_kind=s.get("segment_kind", "narration"),
            voice=s.get("voice") or {"source": "chapter"},
            generated_params=s.get("generated_params"),
            text_transforms=s.get("text_transforms"),
            audio=audio,
            generated_at=_parse_dt(s.get("generated_at")),
            animation_spec_json=s.get("animation_spec_json"),
        ))

    # voice profiles (+ audio files)
    for vp in manifest["voice_profiles"]:
        new_vid = voice_map[vp["id"]]
        preview = _rewrite_voice_audio_for_import(vp, new_vid, files)
        db.add(VoiceProfile(
            id=new_vid, name=vp["name"], project_id=new_pid,
            description=vp.get("description"), avatar=vp.get("avatar"),
            voice=vp.get("voice") or {}, voice_params=vp.get("voice_params") or {},
            preview=preview,
        ))

    # source documents
    for d in manifest["source_documents"]:
        db.add(SourceDocument(
            id=source_map[d["id"]], project_id=new_pid,
            source_type=d.get("source_type", "paste"), title=d.get("title", ""),
            file_path=d.get("file_path"), pasted_text=d.get("pasted_text"),
            audio_path=d.get("audio_path"), file_size=d.get("file_size"),
            duration_sec=d.get("duration_sec"),
        ))

    # project-level source/narration docs
    if proj_data.get("source_document"):
        project.source_document_path = assets.write_project_document(
            new_pid, kind="source", project_name=proj_data["name"],
            text=files.get(proj_data["source_document"], b"").decode("utf-8", "replace"),
        )
    if proj_data.get("narration_document"):
        project.narration_document_path = assets.write_project_document(
            new_pid, kind="narration", project_name=proj_data["name"],
            text=files.get(proj_data["narration_document"], b"").decode("utf-8", "replace"),
        )

    db.flush()
    _write_text_mirror(project, chapter_title_by_new, proj_data["name"])
    db.commit()

    db.refresh(project)
    return project_to_detail(project)


# ── helpers ───────────────────────────────────────────────────────────────


def _read_bundle(zip_bytes: bytes) -> tuple[dict, dict[str, bytes]]:
    z = zipfile.ZipFile(io.BytesIO(zip_bytes))
    manifest = json.loads(z.read("manifest.json"))
    files = {name: z.read(name) for name in z.namelist() if name != "manifest.json"}
    return manifest, files


def _assert_bundle_version(manifest: dict) -> None:
    if manifest.get("bundle_version") != BUNDLE_VERSION:
        raise ValueError(
            f"unsupported bundle_version: {manifest.get('bundle_version')} "
            f"(expected {BUNDLE_VERSION})"
        )


def _rewrite_segment_audio_for_import(seg, new_pid, new_cid, new_sid,
                                       chapter_title, project_name, files) -> dict | None:
    audio = seg.get("audio")
    if not audio:
        return None
    audio = json.loads(json.dumps(audio))
    for slot in ("current", "previous"):
        entry = audio.get(slot)
        if not (entry and isinstance(entry, dict) and entry.get("path")):
            continue
        bundle_path = entry["path"]
        if bundle_path not in files:
            continue
        ext = entry.get("format") or Path(bundle_path).suffix.lstrip(".") or "mp3"
        abs_path = assets.segment_audio_path(
            new_pid, new_cid, chapter_title=chapter_title, project_name=project_name,
            segment_id=new_sid, position=seg["position"], fmt=ext,
        )
        abs_path.parent.mkdir(parents=True, exist_ok=True)
        abs_path.write_bytes(files[bundle_path])
        entry["path"] = abs_path.relative_to(settings.segmented_dir).as_posix()
    return audio


def _rewrite_voice_audio_for_import(vp, new_vid, files) -> dict:
    preview = dict(vp.get("preview") or {})
    rel = preview.get("preview_audio_path")
    if rel and rel in files:
        ext = Path(rel).suffix.lstrip(".") or "mp3"
        target_dir = settings.voices_previews_dir
        target_dir.mkdir(parents=True, exist_ok=True)
        target = target_dir / f"{new_vid}.{ext}"
        target.write_bytes(files[rel])
        preview["preview_audio_path"] = settings.to_relative(target)
    return preview


def _write_text_mirror(project: SegmentedProject, chapter_titles: dict[str, str],
                       project_name: str) -> None:
    assets.write_original_text(project.id, project.original_text or "", project_name=project_name)
    for ch in project.chapters:
        title = chapter_titles.get(ch.id, ch.name)
        assets.ensure_chapter_layout(project.id, ch.id, project_name=project_name)
        assets.write_chapter_original_text(project.id, ch.id,
                                           project_name=project_name, text=ch.original_text or "")
        for pos, seg in enumerate(sorted(ch.segments, key=lambda s: s.position)):
            assets.write_segment_text(project.id, ch.id,
                                      project_name=project_name, segment_id=seg.id,
                                      text=seg.text or "")
    assets.write_manifest(project.id, project_to_detail(project).model_dump(mode="json"),
                          project_name=project_name)


def _parse_dt(s: str | None) -> datetime | None:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s)
    except (ValueError, TypeError):
        return None
