from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.models.voice_profile import VoiceProfile
else:
    # workers bundle 不含 app.models：本模块被 workers 链路顶层 import，
    # 必须可加载；VoiceProfile 仅作类型注解（运行时 duck-typing）。
    VoiceProfile = None


def voice_to_dict(v: VoiceProfile) -> dict:
    """Serialize a VoiceProfile to the standard API response dict.

    Returns voice_params, preview, and has_preview/has_source booleans.
    Audio URLs are constructed by the frontend from /api/clone/audio/{id}?field=preview.
    """
    voice = v.voice or {}
    voice_params = v.voice_params or {}
    preview = v.preview or {}

    has_preview = bool(preview.get("preview_audio_path"))
    model = voice.get("model", "")
    model_params = (voice_params.get(model, {}) or {})
    has_source = bool(model_params.get("source_audio_path"))

    return {
        "id": str(v.id),
        "name": v.name,
        "description": v.description,
        "avatar": v.avatar,
        "project_id": v.project_id,
        "voice": voice,
        "voice_params": voice_params,
        "preview": preview,
        "has_preview": has_preview,
        "has_source": has_source,
        "created_at": v.created_at.isoformat() if v.created_at else None,
    }
