"""部署目标能力清单（spec 第 4 节）。

GET /api/config/capabilities 的事实源：按 deploy_target 给出可用的
TTS 引擎、克隆引擎与功能开关，前端据此隐藏/禁用本地专属能力。
workers 清单必须保持为 local 清单的子集。
"""
from __future__ import annotations

LOCAL_ENGINES = ["edge_tts", "mimo_tts", "cosyvoice", "voxcpm"]
LOCAL_CLONE_ENGINES = ["qwen", "mimo", "voxcpm"]

WORKERS_ENGINES = ["edge_tts", "mimo_tts"]
WORKERS_CLONE_ENGINES = ["mimo"]

_LOCAL_FEATURES = {
    "speech_to_text": True,
    "agent_workflow": True,
    "backend_storage": True,
}


def get_capabilities(deploy_target: str) -> dict:
    """按部署目标返回能力清单。未知目标按 local 全量处理（本地开发体验不变）。"""
    if deploy_target == "workers":
        return {
            "deploy_target": "workers",
            "engines": list(WORKERS_ENGINES),
            "clone_engines": list(WORKERS_CLONE_ENGINES),
            "features": {key: False for key in _LOCAL_FEATURES},
        }
    return {
        "deploy_target": "local",
        "engines": list(LOCAL_ENGINES),
        "clone_engines": list(LOCAL_CLONE_ENGINES),
        "features": dict(_LOCAL_FEATURES),
    }
