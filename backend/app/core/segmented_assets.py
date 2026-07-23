"""Filesystem helpers for the segmented editor's per-project asset directory.

The layout is human-browsable: project/chapter/segment paths embed the
project name, chapter title, and segment position so a file manager view is
meaningful. A short id suffix (first 6 chars of the entity id) is always
appended to guarantee uniqueness when names/titles collide.

    projects/{project_id}/
        source-{project-name}-{project-id-short}.md
        narration-{project-name}-{project-id-short}.md
        original.txt
        chapters/
            chapter-{chapter-title}-{project-name}-{chapter-id-short}/
                original.txt
                segments/
                    segment-{position:03d}-{segment-id-short}.mp3
                    segment-{position:03d}-{segment-id-short}.txt
                    segment-{position:03d}-{segment-id-short}.ssml

The project *directory* itself stays keyed by id (not name) so renaming a
project is a metadata-only change and doesn't require moving files.
"""
from __future__ import annotations

import json
import logging
import re
import shutil
from pathlib import Path
from typing import Any

from app.core.config import settings

logger = logging.getLogger(__name__)

_SHORT_ID_LEN = 6
_UNSAFE_CHARS = re.compile(r"[/\\:*?\"<>|\s]+")


# ----- naming primitives ---------------------------------------------------


def short_id(entity_id: str) -> str:
    """First 6 chars of the id, stable across renames.

    Empty/short ids are returned unchanged so callers get a deterministic
    result even in edge cases (tests, hand-crafted fixtures).
    """
    if not entity_id:
        return ""
    return entity_id[:_SHORT_ID_LEN]


def safe_name_part(value: str) -> str:
    """Filesystem-safe filename fragment: whitespace/separators -> ``_``.

    - Preserves unicode (CJK is fine on all real filesystems we target).
    - Collapses runs of unsafe chars to a single ``_``.
    - Strips a leading ``.`` (would hide the file on POSIX).
    - Falls back to ``"untitled"`` when the result is empty so no path
      component is ever silently blank.
    """
    text = (value or "").strip()
    text = _UNSAFE_CHARS.sub("_", text)
    text = text.lstrip(".")
    return text or "untitled"


# ----- project-level paths -------------------------------------------------


def project_dir(project_id: str) -> Path:
    return settings.segmented_dir / project_id


def source_document_path(project_id: str, project_name: str) -> Path:
    name = f"source-{safe_name_part(project_name)}-{short_id(project_id)}.md"
    return project_dir(project_id) / name


def narration_document_path(project_id: str, project_name: str) -> Path:
    name = f"narration-{safe_name_part(project_name)}-{short_id(project_id)}.md"
    return project_dir(project_id) / name


def write_project_document(
    project_id: str, *, kind: str, project_name: str, text: str
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


def write_original_text(project_id: str, text: str) -> None:
    p = project_dir(project_id) / "original.txt"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text or "", encoding="utf-8")


# ----- chapter-level paths -------------------------------------------------


def _chapter_dirname(chapter_id: str, chapter_title: str, project_name: str) -> str:
    return (
        f"chapter-{safe_name_part(chapter_title)}"
        f"-{safe_name_part(project_name)}"
        f"-{short_id(chapter_id)}"
    )


def chapter_dir(
    project_id: str,
    chapter_id: str,
    *,
    chapter_title: str,
    project_name: str,
) -> Path:
    return (
        project_dir(project_id)
        / "chapters"
        / _chapter_dirname(chapter_id, chapter_title, project_name)
    )


def ensure_chapter_layout(
    project_id: str,
    chapter_id: str,
    *,
    chapter_title: str,
    project_name: str,
) -> Path:
    d = (
        chapter_dir(project_id, chapter_id, chapter_title=chapter_title, project_name=project_name)
        / "segments"
    )
    d.mkdir(parents=True, exist_ok=True)
    return d


def write_chapter_original_text(
    project_id: str,
    chapter_id: str,
    *,
    chapter_title: str,
    project_name: str,
    text: str,
) -> None:
    p = (
        chapter_dir(project_id, chapter_id, chapter_title=chapter_title, project_name=project_name)
        / "original.txt"
    )
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text or "", encoding="utf-8")


def remove_chapter_dir(
    project_id: str,
    chapter_id: str,
    *,
    chapter_title: str,
    project_name: str,
) -> None:
    d = chapter_dir(
        project_id, chapter_id,
        chapter_title=chapter_title, project_name=project_name,
    )
    if d.exists():
        shutil.rmtree(d, ignore_errors=True)


# ----- segment-level paths -------------------------------------------------


def segment_basename(*, position: int, segment_id: str) -> str:
    """``segment-{position:03d}-{id-short}`` (no extension).

    Position-first so files sort naturally in a file explorer; id-short
    disambiguates across re-ordering/renaming and keeps the name short.
    """
    return f"segment-{position:03d}-{short_id(segment_id)}"


def segment_audio_path(
    project_id: str,
    chapter_id: str,
    *,
    chapter_title: str,
    project_name: str,
    segment_id: str,
    position: int,
    fmt: str,
) -> Path:
    cdir = chapter_dir(
        project_id, chapter_id,
        chapter_title=chapter_title, project_name=project_name,
    )
    return cdir / "segments" / f"{segment_basename(position=position, segment_id=segment_id)}.{fmt}"


def write_segment_text(
    project_id: str,
    chapter_id: str,
    *,
    chapter_title: str,
    project_name: str,
    segment_id: str,
    position: int,
    text: str,
) -> None:
    p = segment_audio_path(
        project_id, chapter_id,
        chapter_title=chapter_title, project_name=project_name,
        segment_id=segment_id, position=position, fmt="txt",
    )
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text or "", encoding="utf-8")


def write_segment_ssml(
    project_id: str,
    chapter_id: str,
    *,
    chapter_title: str,
    project_name: str,
    segment_id: str,
    position: int,
    ssml: str,
) -> None:
    p = segment_audio_path(
        project_id, chapter_id,
        chapter_title=chapter_title, project_name=project_name,
        segment_id=segment_id, position=position, fmt="ssml",
    )
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(ssml or "", encoding="utf-8")


def remove_segment_audio(
    project_id: str,
    chapter_id: str,
    *,
    chapter_title: str,
    project_name: str,
    segment_id: str,
    position: int,
    fmt: str,
) -> None:
    p = segment_audio_path(
        project_id, chapter_id,
        chapter_title=chapter_title, project_name=project_name,
        segment_id=segment_id, position=position, fmt=fmt,
    )
    try:
        p.unlink()
    except FileNotFoundError:
        pass


# ----- manifest & top-level cleanup ----------------------------------------


def write_manifest(project_id: str, payload: dict[str, Any]) -> None:
    p = project_dir(project_id) / "manifest.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def read_manifest(project_id: str) -> dict[str, Any] | None:
    p = project_dir(project_id) / "manifest.json"
    if not p.exists():
        return None
    return json.loads(p.read_text(encoding="utf-8"))


def remove_project_dir(project_id: str) -> None:
    d = project_dir(project_id)
    if d.exists():
        shutil.rmtree(d, ignore_errors=True)
        logger.info("Removed segmented project dir %s", d)
