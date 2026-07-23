"""ScaffoldRemotion node (knowledge_video): materialise the Remotion project.

Target dir resolution:

1. Explicit ``state["target_dir"]`` (user override, e.g. UI-specified).
2. Otherwise ``{ANIMATION_ROOT_FOLDER}/{safe_project_dirname(project.name)}``.

``ANIMATION_ROOT_FOLDER`` is a hard requirement — no fallback. The backend
scaffold endpoint is idempotent (existing project dirs are refreshed
in place: per-chapter audio + SRT + segment_manifest.json + AGENTS.md).

No LLM is involved here anymore: this node purely stages assets for the
downstream Remotion animation work; there is no ``animation_brief`` created.
"""
from __future__ import annotations

import re
from pathlib import Path

from langgraph.config import get_stream_writer

from app import backend_client
from app.config import get_animation_root_folder

# Windows/POSIX 双兼容的非法字符集合 + 空白折叠成 "_"。
_ILLEGAL_CHARS_RE = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
_WHITESPACE_RE = re.compile(r"\s+")


def safe_project_dirname(name: str) -> str:
    """Return a filesystem-safe directory name for the Remotion project.

    Rules: strip illegal characters, collapse whitespace to ``_``, fall
    back to ``"project"`` when the sanitised name is empty. Keeps CJK
    intact so the directory stays human-readable.
    """
    if not name:
        return "project"
    cleaned = _ILLEGAL_CHARS_RE.sub("_", name)
    cleaned = _WHITESPACE_RE.sub("_", cleaned).strip("_. ")
    return cleaned or "project"


async def scaffold_remotion_node(state, runtime) -> dict:
    project_id = state["project_id"]
    writer = get_stream_writer()

    async def emit(p):
        writer(p)

    await emit(
        {
            "type": "stage_start",
            "stage": "scaffold_remotion",
            "message": "开始生成 Remotion 工程...",
        }
    )

    # Resolve target directory (state override wins; else env + project name).
    target_dir = state.get("target_dir")
    backend = getattr(runtime, "backend", None) or backend_client.BackendClient()
    if not target_dir:
        try:
            root = get_animation_root_folder()
        except ValueError as exc:
            msg = str(exc)
            await emit({"type": "error", "stage": "scaffold_remotion", "message": msg})
            return {"error": msg, "current_stage": "scaffold_remotion"}
        try:
            project = await backend.get_project(project_id)
        except Exception as exc:
            msg = f"获取项目失败: {exc}"
            await emit({"type": "error", "stage": "scaffold_remotion", "message": msg})
            return {"error": msg, "current_stage": "scaffold_remotion"}
        dirname = safe_project_dirname(project.get("name") or "")
        target_dir = str(Path(root).expanduser() / dirname)

    try:
        result = await backend.scaffold_remotion(project_id, target_dir=target_dir)
    except Exception as exc:
        msg = f"Remotion 工程生成失败: {exc}"
        await emit({"type": "error", "stage": "scaffold_remotion", "message": msg})
        return {"error": msg, "current_stage": "scaffold_remotion"}

    project_dir = result.get("project_dir", target_dir)
    created = result.get("created", False)
    await emit(
        {
            "type": "stage_complete",
            "stage": "scaffold_remotion",
            "message": f"Remotion 工程{'已创建' if created else '已刷新'}: {project_dir}",
            "data": result,
        }
    )
    return {
        "remotion_project_dir": project_dir,
        "current_stage": "completed",
        "error": None,
    }
