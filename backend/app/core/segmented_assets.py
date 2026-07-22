"""Filesystem helpers for the segmented editor's per-project asset directory."""
from __future__ import annotations

import json
import logging
import shutil
from pathlib import Path
from typing import Any

from app.core.config import settings

logger = logging.getLogger(__name__)


def project_dir(project_id: str) -> Path:
    return settings.segmented_dir / project_id


def chapter_dir(project_id: str, chapter_id: str) -> Path:
    return project_dir(project_id) / "chapters" / chapter_id


def segment_audio_path(project_id: str, chapter_id: str, segment_id: str, fmt: str) -> Path:
    return chapter_dir(project_id, chapter_id) / "segments" / f"{segment_id}.{fmt}"


def ensure_project_layout(project_id: str, chapter_id: str) -> Path:
    d = chapter_dir(project_id, chapter_id) / "segments"
    d.mkdir(parents=True, exist_ok=True)
    return d


def write_original_text(project_id: str, text: str) -> None:
    p = project_dir(project_id) / "original.txt"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text or "", encoding="utf-8")


SOURCE_DOCUMENT_NAME = "source.md"
NARRATION_DOCUMENT_NAME = "narration.md"


def write_project_document(project_id: str, name: str, text: str) -> str:
    """Write a project-level document (source/narration) and return its path.

    项目级长文档（源文档、完整旁白稿）的内容只落文件，DB 存该路径。
    """
    p = project_dir(project_id) / name
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


def write_chapter_original_text(project_id: str, chapter_id: str, text: str) -> None:
    p = chapter_dir(project_id, chapter_id) / "original.txt"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text or "", encoding="utf-8")


def write_segment_text(project_id: str, chapter_id: str, segment_id: str, text: str) -> None:
    p = chapter_dir(project_id, chapter_id) / "segments" / f"{segment_id}.txt"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text or "", encoding="utf-8")


def write_segment_ssml(project_id: str, chapter_id: str, segment_id: str, ssml: str) -> None:
    p = chapter_dir(project_id, chapter_id) / "segments" / f"{segment_id}.ssml"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(ssml or "", encoding="utf-8")


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


def remove_segment_audio(project_id: str, chapter_id: str, segment_id: str, fmt: str) -> None:
    p = segment_audio_path(project_id, chapter_id, segment_id, fmt)
    try:
        p.unlink()
    except FileNotFoundError:
        pass


def remove_chapter_dir(project_id: str, chapter_id: str) -> None:
    d = chapter_dir(project_id, chapter_id)
    if d.exists():
        shutil.rmtree(d, ignore_errors=True)
