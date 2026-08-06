"""ScaffoldRemotion node (knowledge_video): materialise the Remotion project.

Target dir resolution lives in the backend: per-run override
``state["target_dir"]`` > per-project ``remotion_project_path`` > global DB
setting ``{animation_root_folder}/{safe_project_name}``. When nothing is
configured the backend returns 422 ``animation_root_not_configured`` and this
node surfaces a guidance message pointing to the settings page.

No LLM is involved here: this node purely stages assets for the downstream
Remotion animation work; there is no ``animation_brief`` created.
"""
from __future__ import annotations

import httpx
from langgraph.config import get_stream_writer

from app import backend_client


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

    # Per-run override only; otherwise the backend resolves
    # (global DB setting > per-project remotion_project_path).
    target_dir = state.get("target_dir")
    backend = getattr(runtime, "backend", None) or backend_client.BackendClient()

    try:
        result = await backend.scaffold_remotion(project_id, target_dir=target_dir)
    except httpx.HTTPStatusError as exc:
        detail = ""
        try:
            detail = exc.response.json().get("detail", "")
        except Exception:
            pass
        if detail == "animation_root_not_configured":
            msg = "未配置 Remotion 脚手架根目录，请到设置页填写"
        else:
            msg = f"Remotion 工程生成失败: {exc}"
        await emit({"type": "error", "stage": "scaffold_remotion", "message": msg})
        return {"error": msg, "current_stage": "scaffold_remotion"}
    except Exception as exc:
        msg = f"Remotion 工程生成失败: {exc}"
        await emit({"type": "error", "stage": "scaffold_remotion", "message": msg})
        return {"error": msg, "current_stage": "scaffold_remotion"}

    project_dir = result.project_dir or target_dir
    created = result.created
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
