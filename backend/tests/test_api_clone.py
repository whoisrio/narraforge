import pytest
from fastapi.testclient import TestClient
from io import BytesIO


# Fields every VoiceProfile API response must include (the canonical
# `voice_to_dict` shape). /upload previously returned a trimmed 5-field dict
# that left the frontend `VoiceProfile` type full of `undefined` (audit A5).
VOICE_PROFILE_FIELDS = {
    "id", "name", "description", "avatar", "project_id",
    "voice", "voice_params", "preview", "has_preview", "has_source",
    "created_at",
}


def test_upload_voice(client: TestClient):
    """上传音频文件 -> 返回完整 VoiceProfile 形状（A5 回归）."""
    audio_data = BytesIO(b"fake audio data")
    files = {"file": ("test.mp3", audio_data, "audio/mpeg")}

    response = client.post("/api/clone/upload", files=files)
    assert response.status_code == 200
    data = response.json()
    assert VOICE_PROFILE_FIELDS.issubset(data.keys())
    assert data["has_source"] is True
    # The trimmed-response fields (audio_url/is_cloned/prompt_text) are gone.
    assert "audio_url" not in data


def test_upload_voice_preserves_prompt_text_in_voice_params(client: TestClient):
    """prompt_text 仍可通过 voice_params 取回（不再在顶层）."""
    audio_data = BytesIO(b"fake audio data")
    files = {"file": ("test.mp3", audio_data, "audio/mpeg")}
    response = client.post("/api/clone/upload", files=files, data={"prompt_text": "hello"})
    assert response.status_code == 200
    data = response.json()
    # upload stores params under the "" (empty model) key
    params = data["voice_params"].get("", {}).get("params", {})
    assert params.get("prompt_text") == "hello"


def test_upload_from_url_returns_full_voice_profile(client: TestClient, monkeypatch):
    """/clone/upload-from-url 也返回完整 VoiceProfile 形状（A5）."""
    import requests

    class FakeResp:
        status_code = 200
        headers = {"Content-Type": "audio/mpeg"}
        def iter_content(self, chunk_size=8192):
            yield b"fake audio"

    monkeypatch.setattr(requests, "head", lambda *a, **k: FakeResp())
    monkeypatch.setattr(requests, "get", lambda *a, **k: FakeResp())

    response = client.post("/api/clone/upload-from-url", json={
        "audio_url": "https://example.com/a.mp3",
        "name": "from-url",
    })
    assert response.status_code == 200, response.text
    data = response.json()
    assert VOICE_PROFILE_FIELDS.issubset(data.keys())
    assert data["name"] == "from-url"


def test_list_voices_returns_full_voice_profile_shape(client: TestClient, db_session):
    """list 端点每项都是完整 VoiceProfile 形状."""
    from app.models.voice_profile import VoiceProfile
    db_session.add(VoiceProfile(id="v-list", name="list-voice", voice={"model": ""}, voice_params={}))
    db_session.commit()
    response = client.get("/api/clone/list")
    assert response.status_code == 200
    items = response.json()
    assert any(v["id"] == "v-list" for v in items)
    matched = next(v for v in items if v["id"] == "v-list")
    assert VOICE_PROFILE_FIELDS.issubset(matched.keys())
