"""Remotion project scaffolding for the knowledge_video workflow.

Creates a blank Remotion project via ``npx create-video`` (skipped when the
target dir already holds one), then refreshes derived assets: per-chapter
concatenated audio, per-chapter SRT, ``segment_manifest.json`` and
``AGENTS.md``. Optionally writes ``animation_brief.json``. Idempotent.
"""
from __future__ import annotations

import json
import logging
import shutil
import subprocess
from pathlib import Path

from sqlalchemy.orm import Session

from app.services import segmented_project_service as svc
from app.services.srt_service import build_srt

logger = logging.getLogger(__name__)

CREATE_VIDEO_TIMEOUT_SEC = 600


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
        "- `animation_brief.json` — 动画分镜 brief（每段旁白的呈现内容与动画效果）",
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
    animation_brief: dict | None = None,
) -> dict:
    project = svc.get_project_row(db, project_id)
    if project is None:
        raise LookupError("project_not_found")

    target = target_dir or getattr(project, "remotion_project_path", None)
    if not target:
        raise ValueError("remotion_target_not_set")
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

    if animation_brief is not None:
        (root / "animation_brief.json").write_text(
            json.dumps(animation_brief, ensure_ascii=False, indent=2), encoding="utf-8"
        )

    return {"project_dir": str(root), "created": created, "chapters": len(chapters_manifest)}
