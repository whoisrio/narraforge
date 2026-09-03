"""Filesystem helpers for the segmented editor's per-project asset directory.

Layout (unified data root, plan B):

    data/projects/{project-slug}/
        manifest.json           (id → name/title mapping)
        source.md / narration.md / original.txt
        chapters/{chapter-id}/
            original.txt
            segments/{segment-id}.mp3|txt|ssml

Design rules:

- The project directory uses the name slug (pinyin) for browsability; name
  collisions get a deterministic ``-{hash4}`` suffix of the DB id.
- Chapter/segment paths use raw, immutable DB ids — renaming a chapter
  title never moves a file.
- Readers NEVER guess paths: DB stores the full (relative) path for every
  asset; constructors here are for WRITING new files only.
- DB-stored paths are relative to ``settings.segmented_dir`` (the asset
  root, alias ``projects_dir``).
"""
from __future__ import annotations

import hashlib
import json
import logging
import re
import shutil
from pathlib import Path
from typing import Any

from app.core.config import settings
from app.services.narration_versioning.ids import project_slug

logger = logging.getLogger(__name__)

_SHORT_ID_LEN = 6
_UNSAFE_CHARS = re.compile(r"[/\\:*?\"<>|\s]+")


# ----- naming primitives ---------------------------------------------------


def short_id(entity_id: str) -> str:
    """First 6 chars of the id, stable across renames."""
    if not entity_id:
        return ""
    return entity_id[:_SHORT_ID_LEN]


def safe_name_part(value: str) -> str:
    """Filesystem-safe filename fragment: whitespace/separators -> ``_``."""
    text = (value or "").strip()
    text = _UNSAFE_CHARS.sub("_", text)
    text = text.lstrip(".")
    return text or "untitled"


def _hash4(value: str) -> str:
    return hashlib.blake2s(str(value).encode("utf-8"), digest_size=2).hexdigest()


# ----- project-level paths -------------------------------------------------


def _project_dirname(project_id: str, project_name: str | None) -> str:
    """Slug of the project name; hash-suffixed when the slug is taken by
    ANOTHER project (detected via its manifest)."""
    if not project_name:
        return project_id
    slug = project_slug(project_name)
    if slug == project_id:
        return slug
    candidate = settings.segmented_dir / slug
    if candidate.exists():
        manifest_file = candidate / "manifest.json"
        owner = None
        if manifest_file.exists():
            try:
                owner = (json.loads(manifest_file.read_text(encoding="utf-8")) or {}).get("id")
            except (ValueError, OSError):
                owner = None
        if owner is not None and owner != project_id:
            return f"{slug}-{_hash4(project_id)}"
    return slug


def project_dir(project_id: str, project_name: str | None = None) -> Path:
    return settings.segmented_dir / _project_dirname(project_id, project_name)


def source_document_path(project_id: str, project_name: str | None = None) -> Path:
    return project_dir(project_id, project_name) / "source.md"


def narration_document_path(project_id: str, project_name: str | None = None) -> Path:
    return project_dir(project_id, project_name) / "narration.md"


def write_project_document(
    project_id: str, *, kind: str, project_name: str | None = None, text: str
) -> str:
    """Write a project-level document (kind='source'|'narration'); return path.

    项目级长文档（源文档、完整旁白稿）的内容只落文件，DB 存该路径。
    """
    if kind == "source":
        p = source_document_path(project_id, project_name)
    elif kind == "narration":
        p = narration_document_path(project_id, project_name)
    else:  # pragma: no cover - defensive
        raise ValueError(f"unknown project document kind: {kind!r}")
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text or "", encoding="utf-8")
    return str(p)


def read_project_document(path: str | None) -> str | None:
    """Read a project-level document by its stored path; None/missing -> None."""
    if not path:
        return None
    p = Path(path)
    if not p.exists():
        return None
    return p.read_text(encoding="utf-8")


def write_original_text(project_id: str, text: str, project_name: str | None = None) -> None:
    p = project_dir(project_id, project_name) / "original.txt"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text or "", encoding="utf-8")


# ----- chapter-level paths -------------------------------------------------


def chapter_dir(
    project_id: str,
    chapter_id: str,
    *,
    project_name: str | None = None,
) -> Path:
    return project_dir(project_id, project_name) / "chapters" / chapter_id


def ensure_chapter_layout(
    project_id: str,
    chapter_id: str,
    *,
    project_name: str | None = None,
    **_: Any,
) -> Path:
    d = chapter_dir(project_id, chapter_id, project_name=project_name) / "segments"
    d.mkdir(parents=True, exist_ok=True)
    return d


def write_chapter_original_text(
    project_id: str,
    chapter_id: str,
    *,
    project_name: str | None = None,
    text: str,
    **_: Any,
) -> None:
    p = chapter_dir(project_id, chapter_id, project_name=project_name) / "original.txt"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text or "", encoding="utf-8")


def remove_chapter_dir(
    project_id: str,
    chapter_id: str,
    *,
    project_name: str | None = None,
    **_: Any,
) -> None:
    d = chapter_dir(project_id, chapter_id, project_name=project_name)
    if d.exists():
        shutil.rmtree(d, ignore_errors=True)


# ----- segment-level paths -------------------------------------------------


def segment_audio_path(
    project_id: str,
    chapter_id: str,
    *,
    project_name: str | None = None,
    segment_id: str,
    fmt: str,
    **_: Any,
) -> Path:
    return chapter_dir(project_id, chapter_id, project_name=project_name) / "segments" / f"{segment_id}.{fmt}"


def write_segment_text(
    project_id: str,
    chapter_id: str,
    *,
    project_name: str | None = None,
    segment_id: str,
    text: str,
    **_: Any,
) -> None:
    p = segment_audio_path(
        project_id, chapter_id,
        project_name=project_name, segment_id=segment_id, fmt="txt",
    )
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text or "", encoding="utf-8")


def write_segment_ssml(
    project_id: str,
    chapter_id: str,
    *,
    project_name: str | None = None,
    segment_id: str,
    ssml: str,
    **_: Any,
) -> None:
    p = segment_audio_path(
        project_id, chapter_id,
        project_name=project_name, segment_id=segment_id, fmt="ssml",
    )
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(ssml or "", encoding="utf-8")


def delete_audio_file(rel_path: str | None) -> bool:
    """Delete an audio file by its DB-stored path (relative to the asset root).

    This is the PREFERRED deletion path: the DB knows exactly where the file
    is, regardless of the naming scheme it was written with. Returns True
    when a file was actually removed.
    """
    if not rel_path:
        return False
    p = Path(rel_path)
    if not p.is_absolute():
        p = settings.segmented_dir / p
    try:
        p.unlink()
        return True
    except FileNotFoundError:
        return False
    except OSError:
        return False


def remove_segment_audio(
    project_id: str,
    chapter_id: str,
    *,
    project_name: str | None = None,
    segment_id: str,
    fmt: str,
    **_: Any,
) -> None:
    """Fallback deletion by reconstructing the current-scheme path.

    Prefer ``delete_audio_file`` whenever the DB-stored path is available.
    """
    p = segment_audio_path(
        project_id, chapter_id,
        project_name=project_name, segment_id=segment_id, fmt=fmt,
    )
    try:
        p.unlink()
    except FileNotFoundError:
        pass


# ----- manifest & top-level cleanup ----------------------------------------


def write_manifest(project_id: str, payload: dict[str, Any], project_name: str | None = None) -> None:
    p = project_dir(project_id, project_name) / "manifest.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def read_manifest(project_id: str, project_name: str | None = None) -> dict[str, Any] | None:
    p = project_dir(project_id, project_name) / "manifest.json"
    if not p.exists():
        return None
    return json.loads(p.read_text(encoding="utf-8"))


def _manifest_owner_id(dir_path) -> str | None:
    """Best-effort read of the project id stored in a dir's manifest.json."""
    manifest_file = dir_path / "manifest.json"
    if not manifest_file.exists():
        return None
    try:
        return (json.loads(manifest_file.read_text(encoding="utf-8")) or {}).get("id")
    except (ValueError, OSError):
        return None


def remove_project_dir(project_id: str, project_name: str | None = None) -> bool:
    """Remove the project's asset directory; return True if anything was removed.

    Handles the case where the dir was hash-suffixed at create time because of a
    name collision that has since been resolved (the colliding project deleted):
    then the plain-slug derivation misses it, so we also try the deterministic
    ``slug-{hash4(id)}`` variant — but only remove it if it belongs to this
    project or is an orphan, never a dir owned by a different live project.
    """
    d = project_dir(project_id, project_name)
    removed = False
    if d.exists():
        shutil.rmtree(d, ignore_errors=True)
        logger.info("Removed segmented project dir %s", d)
        removed = True
    if not removed and project_name:
        slug = project_slug(project_name)
        if slug and slug != project_id:
            suffixed = settings.segmented_dir / f"{slug}-{_hash4(project_id)}"
            if suffixed.exists():
                owner = _manifest_owner_id(suffixed)
                if owner is None or owner == project_id:
                    shutil.rmtree(suffixed, ignore_errors=True)
                    logger.info("Removed suffixed segmented project dir %s", suffixed)
                    removed = True
    return removed
