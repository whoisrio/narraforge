"""Remotion project scaffolding for the knowledge_video workflow.

Creates a blank Remotion project via ``npx create-video`` (skipped when the
target dir already holds one), then refreshes derived assets: per-chapter
concatenated audio, per-chapter SRT, ``segment_manifest.json`` and
``AGENTS.md``. Idempotent.
"""
from __future__ import annotations

import json
import logging
import re
import shutil
import subprocess
from pathlib import Path

from sqlalchemy.orm import Session

from app.core.system_config_service import get_animation_root_folder
from app.services import segmented_project_service as svc
from app.services.srt_service import build_srt

logger = logging.getLogger(__name__)

CREATE_VIDEO_TIMEOUT_SEC = 600

# Windows/POSIX 兼容的非法字符集合 + 空白折叠成 "_"。与历史 agent 版本一致。
_ILLEGAL_CHARS_RE = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
_WHITESPACE_RE = re.compile(r"\s+")


def safe_project_dirname(name: str) -> str:
    """返回文件系统安全的 Remotion 工程目录名。

    规则：剥离非法字符、折叠空白为 ``_``、空结果回退 ``"project"``，保留 CJK。
    与 agent 旧版完全一致，保证已生成的项目路径不变。
    """
    if not name:
        return "project"
    cleaned = _ILLEGAL_CHARS_RE.sub("_", name)
    cleaned = _WHITESPACE_RE.sub("_", cleaned).strip("_. ")
    return cleaned or "project"


def _is_remotion_project(root: Path) -> bool:
    pkg = root / "package.json"
    if not pkg.exists():
        return False
    try:
        data = json.loads(pkg.read_text(encoding="utf-8"))
    except Exception:
        return False
    deps = {**data.get("dependencies", {}), **data.get("devDependencies", {})}
    return "remotion" in deps


def _create_remotion_project(root: Path) -> None:
    if shutil.which("npx") is None:
        raise RuntimeError("npx_not_found: 需要先在服务器上安装 Node.js")
    root.mkdir(parents=True, exist_ok=True)
    proc = subprocess.run(
        ["npx", "create-video@latest", "--yes", "--blank", "."],
        cwd=root,
        capture_output=True,
        text=True,
        timeout=CREATE_VIDEO_TIMEOUT_SEC,
    )
    if proc.returncode != 0:
        tail = (proc.stderr or proc.stdout or "")[-500:]
        raise RuntimeError(f"create_video_failed: {tail}")


def _render_agents_md(project_name: str, chapters: list[dict]) -> str:
    lines = [
        f"# {project_name} — Remotion 工程",
        "",
        "本工程由 NarraForge knowledge_video 工作流生成。",
        "",
        "## 资产",
        "- `public/audio/` — 各章节旁白音频（MP3，按章节标题命名）",
        "- `public/subtitles/chapter_<position>.srt` — 各章节字幕",
        "- `segment_manifest.json` — 章节/资产清单（含时长）",
        "",
        "## 预览",
        "```bash",
        "npm install   # 首次",
        "npx remotion studio",
        "```",
        "",
        "## 章节",
    ]
    for ch in chapters:
        lines.append(f"- {ch['position']}. {ch['title']}（{ch['duration_sec']:.1f}s）")
    lines.append("")
    return "\n".join(lines)


def scaffold_remotion_project(
    db: Session,
    project_id: str,
    target_dir: str | None = None,
) -> dict:
    project = svc.get_project_row(db, project_id)
    if project is None:
        raise LookupError("project_not_found")

    target = target_dir or getattr(project, "remotion_project_path", None)
    if not target:
        root_setting = get_animation_root_folder(db)
        if root_setting:
            target = str(Path(root_setting) / safe_project_dirname(project.name or ""))
    if not target:
        raise ValueError("animation_root_not_configured")
    root = Path(target).expanduser()

    created = False
    if _is_remotion_project(root):
        logger.info("remotion project exists at %s, refreshing assets only", root)
    else:
        _create_remotion_project(root)
        created = True

    if getattr(project, "remotion_project_path", None) != str(root):
        project.remotion_project_path = str(root)
        db.commit()

    chapters_manifest: list[dict] = []
    for ch in sorted(project.chapters, key=lambda c: c.position):
        segs = sorted(ch.segments, key=lambda s: s.position)
        seg_entries: list[dict] = []
        duration_total = 0.0
        for s in segs:
            audio = s.audio or {}
            dur = 0.0
            if isinstance(audio, dict):
                dur = float((audio.get("current") or {}).get("duration_sec") or 0.0)
            seg_entries.append({"text": s.text or "", "duration_sec": dur})
            duration_total += dur

        audio_rel = None
        if any(e["duration_sec"] > 0 for e in seg_entries):
            exported = svc.export_chapter_audio_mp3(db, project_id, ch.id, "public/audio")
            audio_rel = f"public/audio/{exported.name}"

        srt_rel = f"public/subtitles/chapter_{ch.position}.srt"
        srt_path = root / srt_rel
        srt_path.parent.mkdir(parents=True, exist_ok=True)
        srt_path.write_text(build_srt(seg_entries), encoding="utf-8")

        chapters_manifest.append(
            {
                "chapter_id": ch.id,
                "position": ch.position,
                "title": getattr(ch, "design_title", None) or ch.name,
                "audio": audio_rel,
                "subtitles": srt_rel,
                "duration_sec": round(duration_total, 3),
            }
        )

    manifest = {
        "project_id": project_id,
        "project_name": project.name,
        "chapters": chapters_manifest,
    }
    (root / "segment_manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (root / "AGENTS.md").write_text(
        _render_agents_md(project.name, chapters_manifest), encoding="utf-8"
    )

    return {"project_dir": str(root), "created": created, "chapters": len(chapters_manifest)}
