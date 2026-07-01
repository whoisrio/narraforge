from __future__ import annotations

from app.models.voice_profile import VoiceProfile


def voice_to_dict(v: VoiceProfile) -> dict:
    """Serialize a VoiceProfile to the standard API response dict."""
    voice = v.voice or {}
    voice_params = v.voice_params or {}
    preview = v.preview or {}

    # Audio URLs from voice_params.<model>.source_audio_path and preview.preview_audio_path
    model = voice.get("model", "")
    model_params = (voice_params.get(model, {}) or {})
    source_path = model_params.get("source_audio_path") or ""
    preview_path = preview.get("preview_audio_path") or ""
    has_preview = bool(preview_path)
    has_source = bool(source_path)

    audio_url = (
        f"/api/clone/audio/{v.id}?field=preview" if has_preview
        else f"/api/clone/audio/{v.id}?field=source" if has_source
        else f"/api/clone/audio/{v.id}"
    )

    return {
        "id": str(v.id),
        "name": v.name,
        "description": v.description,
        "avatar": v.avatar,
        "project_id": v.project_id,
        "voice": voice,
        "voice_params": voice_params,
        "preview": preview,
        "audio_url": audio_url,
        "source_audio_url": f"/api/clone/audio/{v.id}?field=source" if has_source else None,
        "preview_audio_url": f"/api/clone/audio/{v.id}?field=preview" if has_preview else None,
        "created_at": v.created_at.isoformat() if v.created_at else None,
    }
