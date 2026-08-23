"""部署目标能力清单（spec 第 4 节）。

GET /api/config/capabilities 的事实源：按 deploy_target 给出可用的
TTS 引擎、克隆引擎与功能开关，前端据此隐藏/禁用本地专属能力。
workers 清单必须保持为 local 清单的子集。
"""
from __future__ import annotations

LOCAL_ENGINES = ["edge_tts", "mimo_tts", "cosyvoice", "voxcpm", "indextts"]
# indextts 不进 clone_engines：zero-shot 直接引用已有 VoiceProfile 音频，无克隆注册流程
LOCAL_CLONE_ENGINES = ["qwen", "mimo", "voxcpm"]

WORKERS_ENGINES = ["edge_tts", "mimo_tts"]
WORKERS_CLONE_ENGINES = ["mimo"]

_LOCAL_FEATURES = {
    "speech_to_text": True,
    "agent_workflow": True,
    "backend_storage": True,
    # 克隆音频直传 Supabase Storage（presigned upload URL）：仅 workers 模式需要
    # （Vercel 请求体 4.5MB 上限）；local 走原 multipart 上传，行为不变。
    "direct_storage_upload": False,
}


def get_capabilities(deploy_target: str) -> dict:
    """按部署目标返回能力清单。未知目标按 local 全量处理（本地开发体验不变）。"""
    if deploy_target == "workers":
        features = {key: False for key in _LOCAL_FEATURES}
        features["direct_storage_upload"] = True
        # 后端存储可用：TTS 历史 / 分段项目音频经 asset store 存 Supabase Storage，
        # 记录走 Supabase 仓储（原 spec §4 定"workers 无后端存储"，2026-08 放开）
        features["backend_storage"] = True
        return {
            "deploy_target": "workers",
            "engines": list(WORKERS_ENGINES),
            "clone_engines": list(WORKERS_CLONE_ENGINES),
            "features": features,
        }
    return {
        "deploy_target": "local",
        "engines": list(LOCAL_ENGINES),
        "clone_engines": list(LOCAL_CLONE_ENGINES),
        "features": dict(_LOCAL_FEATURES),
    }
