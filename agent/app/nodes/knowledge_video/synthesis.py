"""Synthesis node (knowledge_video): engine-aware TTS per segment.

Defaults per selected engine:

- ``edge_tts``   → ``DEFAULT_EDGE_VOICE`` (fallback / default when no engine set)
- ``mimo_tts``   → preset voice ``冰糖`` (backend mimo_tts preset mode)
- ``voxcpm``     → clone via ``VOXCPM_DEFAULT_ROLE_ID`` env var (halts when unset)
- ``cosyvoice``  → no special default, backend chapter voice params take over

Any per-segment failure (or a missing voxcpm role id) sets ``error`` on the
returned state so the graph's ``synthesis → scaffold_remotion`` conditional
edge routes to ``END`` — we don't want to scaffold a Remotion project when
part of the audio track is missing.
"""
from __future__ import annotations

from langgraph.config import get_stream_writer

from app import backend_client
from app.config import get_voxcpm_default_role_id

DEFAULT_EDGE_VOICE = "zh-CN-XiaoxiaoNeural"
DEFAULT_MIMO_PRESET_VOICE = "冰糖"


def _resolve_engine_params(engine: str) -> tuple[dict | None, str | None]:
    """Return ``(params, error)`` for the given engine.

    ``params is None`` when the engine cannot be used (e.g. voxcpm without
    a default role id). In that case ``error`` describes why so we can
    halt the workflow before hitting the backend.
    """
    if engine == "mimo_tts":
        return (
            {
                "engine": "mimo_tts",
                "mimo_mode": "preset",
                "mimo_preset_voice": DEFAULT_MIMO_PRESET_VOICE,
            },
            None,
        )
    if engine == "voxcpm":
        role_id = get_voxcpm_default_role_id()
        if not role_id:
            return (
                None,
                "voxcpm 默认角色未配置：请在 agent/.env 设置 VOXCPM_DEFAULT_ROLE_ID",
            )
        return ({"engine": "voxcpm", "role_id": role_id}, None)
    if engine == "cosyvoice":
        # 交由后端使用章节/角色已配置的 cosyvoice 参数
        return ({"engine": "cosyvoice"}, None)
    # edge_tts + fallback
    return ({"engine": "edge_tts", "edge_voice": DEFAULT_EDGE_VOICE}, None)


async def kv_synthesis_node(state, runtime) -> dict:
    project_id = state["project_id"]
    structured = state.get("structured_segments", [])
    writer = get_stream_writer()

    async def emit(p):
        writer(p)

    if not structured:
        await emit(
            {
                "type": "stage_complete",
                "stage": "synthesis",
                "message": "无段落数据，跳过语音合成",
            }
        )
        return {"synthesis_results": [], "current_stage": "scaffold_remotion", "error": None}

    engine = state.get("tts_engine") or "edge_tts"
    params, engine_error = _resolve_engine_params(engine)
    if engine_error is not None:
        await emit({"type": "error", "stage": "synthesis", "message": engine_error})
        return {
            "synthesis_results": [],
            "current_stage": "synthesis",
            "error": engine_error,
        }

    total = sum(len(ch.get("segments", [])) for ch in structured)
    await emit(
        {
            "type": "stage_start",
            "stage": "synthesis",
            "message": f"开始语音合成 (engine={engine}): {total} 段落...",
            "data": {"engine": engine, "params": params},
        }
    )

    backend = getattr(runtime, "backend", None) or backend_client.BackendClient()
    results: list[dict] = []
    failures: list[str] = []
    done = 0
    for ch in structured:
        cid = ch.get("_chapter_id")
        if not cid:
            continue
        for seg in ch.get("segments", []):
            sid = seg.get("_segment_id")
            if not sid:
                continue
            try:
                await backend.synthesize_segment(project_id, cid, sid, params=params)
                results.append(
                    {
                        "chapter_id": cid,
                        "segment_id": sid,
                        "audio_path": None,
                        "duration_sec": None,
                    }
                )
            except Exception as exc:
                failures.append(f"{sid}: {exc}")
                await emit(
                    {
                        "type": "error",
                        "stage": "synthesis",
                        "message": f"段落 {sid} 合成失败: {exc}",
                    }
                )
            done += 1
            await emit(
                {
                    "type": "progress",
                    "stage": "synthesis",
                    "message": f"语音合成进度: {done}/{total}",
                    "data": {"completed": done, "total": total},
                }
            )

    if failures:
        err = f"语音合成失败 {len(failures)}/{total} 段: " + "; ".join(failures[:3])
        await emit(
            {
                "type": "stage_complete",
                "stage": "synthesis",
                "message": err,
                "data": {"failed": len(failures), "succeeded": len(results), "total": total},
            }
        )
        return {
            "synthesis_results": results,
            "current_stage": "synthesis",
            "error": err,
        }

    await emit(
        {
            "type": "stage_complete",
            "stage": "synthesis",
            "message": f"语音合成完成: {len(results)} 段落",
            "data": {"total_segments": len(results)},
        }
    )
    return {
        "synthesis_results": results,
        "current_stage": "scaffold_remotion",
        "error": None,
    }
