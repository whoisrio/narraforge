"""ScaffoldRemotion node (knowledge_video): create/refresh the Remotion project.

Delegates to the backend's scaffold-remotion endpoint, which is idempotent:
existing projects are kept and only assets are refreshed. A failure here
does not lose prior work -- synthesis results stay in state and the run can
be retried after fixing the environment (Node.js, target dir, ...).
"""
from __future__ import annotations

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

    backend = getattr(runtime, "backend", None) or backend_client.BackendClient()
    try:
        result = await backend.scaffold_remotion(
            project_id, target_dir=state.get("target_dir")
        )
    except Exception as exc:
        await emit(
            {
                "type": "error",
                "stage": "scaffold_remotion",
                "message": f"Remotion 工程生成失败: {exc}",
            }
        )
        return {
            "error": f"Remotion 工程生成失败: {exc}",
            "current_stage": "scaffold_remotion",
        }

    project_dir = result.get("project_dir", "")
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
        "current_stage": "gen_animation_brief",
        "error": None,
    }
