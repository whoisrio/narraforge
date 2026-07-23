"""Serialize a SegmentedProject-like object to a git-friendly file tree.

Layout (rooted at `root/projects/{project.id}/`):
    project.yaml
    source.md            (only when source_document non-null)
    chapters/{chapter.id}/
        chapter.yaml
        original.md      (only when original_text non-null)
        script.md        (only when narration_script non-null)
        segments.md      (one HTML comment header + text block per segment)
    narration.md       (project-level full narration script, when non-null)

YAML output uses sort_keys=True for deterministic diffs.
Chapter subdirs no longer in the input are removed so `git status`
reflects deletions.
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import yaml


def write_project(project, root: Path) -> Path:
    proj_dir = root / "projects" / project.id
    proj_dir.mkdir(parents=True, exist_ok=True)

    _write_yaml(proj_dir / "project.yaml", {
        "id": project.id,
        "name": project.name,
        "layout": project.layout,
        "active_chapter_id": getattr(project, "active_chapter_id", None),
        "animation_theme": getattr(project, "animation_theme", None),
        "remotion_project_path": getattr(project, "remotion_project_path", None),
        "default_narrator_role_id": getattr(project, "default_narrator_role_id", None),
        "configs": getattr(project, "configs", None) or {},
    })
    _write_text_or_delete(proj_dir / "source.md", _project_document(project, "source_document_path", "source_document"))
    _write_text_or_delete(proj_dir / "narration.md", _project_document(project, "narration_document_path", None))

    chapters_dir = proj_dir / "chapters"
    chapters_dir.mkdir(exist_ok=True)
    written = set()
    for ch in project.chapters:
        ch_dir = chapters_dir / ch.id
        ch_dir.mkdir(exist_ok=True)
        written.add(ch_dir.name)
        _write_yaml(ch_dir / "chapter.yaml", {
            "id": ch.id,
            "position": ch.position,
            "name": ch.name,
            "design_title": getattr(ch, "design_title", None),
            "voice": getattr(ch, "voice", None) or {},
            "split_config": getattr(ch, "split_config", None) or {},
        })
        _write_text_or_delete(ch_dir / "original.md", getattr(ch, "original_text", None))
        _write_text_or_delete(ch_dir / "script.md", getattr(ch, "narration_script", None))
        _write_segments_md(ch_dir / "segments.md", ch.segments)

    for stale in chapters_dir.iterdir():
        if stale.is_dir() and stale.name not in written:
            _rmtree(stale)
    return proj_dir


def _write_yaml(path: Path, data: dict[str, Any]) -> None:
    path.write_text(
        yaml.safe_dump(data, sort_keys=True, allow_unicode=True, default_flow_style=False),
        encoding="utf-8",
    )


def _project_document(project, path_attr: str, content_attr: str | None) -> str | None:
    """项目级文档内容：优先按 DB 中存的路径读文件，回退到遗留 TEXT 列。"""
    from app.core.segmented_assets import read_project_document

    content = read_project_document(getattr(project, path_attr, None))
    if content is None and content_attr:
        content = getattr(project, content_attr, None)
    return content


def _write_text_or_delete(path: Path, text: str | None) -> None:
    if text is None:
        if path.exists():
            path.unlink()
        return
    path.write_text(text, encoding="utf-8")


def _write_segments_md(path: Path, segments) -> None:
    parts: list[str] = []
    for seg in segments:
        parts.append(_segment_header(seg))
        parts.append(seg.text if seg.text is not None else "")
        parts.append("")
    body = "\n".join(parts).rstrip() + "\n"
    path.write_text(body, encoding="utf-8")


def _segment_header(seg) -> str:
    parts = [seg.id, f"kind={seg.segment_kind}"]
    if getattr(seg, "role_id", None):
        parts.append(f"role={seg.role_id}")
    if getattr(seg, "emotion", None):
        parts.append(f"emotion={seg.emotion}")
    voice = getattr(seg, "voice", None) or {}
    if voice and voice != {"source": "chapter"}:
        parts.append(f"voice={json.dumps(voice, ensure_ascii=False, sort_keys=True, separators=(',', ':'))}")
    return "<!-- " + " ".join(parts) + " -->"


def _rmtree(p: Path) -> None:
    for child in p.iterdir():
        if child.is_dir():
            _rmtree(child)
        else:
            child.unlink()
    p.rmdir()


# ── reader (round-trip aid; used by tests and future checkout work) ──────────

_HEADER_RE = re.compile(r"^<!--\s+(s\d{3})\s+(.*?)\s+-->$")


def parse_segments_md(text: str) -> list[dict]:
    out: list[dict] = []
    current: dict | None = None
    body: list[str] = []
    for line in text.splitlines():
        m = _HEADER_RE.match(line)
        if m:
            if current is not None:
                current["text"] = "\n".join(body).strip("\n")
                out.append(current)
            current = {"id": m.group(1)}
            for k, v in _iter_kv(m.group(2)):
                try:
                    current[k] = json.loads(v)
                except (ValueError, json.JSONDecodeError):
                    current[k] = v
            body = []
        elif current is not None:
            body.append(line)
    if current is not None:
        current["text"] = "\n".join(body).strip("\n")
        out.append(current)
    return out


def _iter_kv(header_body: str):
    """Yield (key, raw_value_str). Splits on top-level whitespace, respecting `{...}` blocks."""
    i, n = 0, len(header_body)
    while i < n:
        while i < n and header_body[i].isspace():
            i += 1
        j = i
        while j < n and header_body[j] != "=":
            j += 1
        if j >= n:
            return
        key = header_body[i:j]
        j += 1
        start = j
        depth = 0
        while j < n:
            c = header_body[j]
            if c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
            elif c.isspace() and depth == 0:
                break
            j += 1
        yield key, header_body[start:j]
        i = j
