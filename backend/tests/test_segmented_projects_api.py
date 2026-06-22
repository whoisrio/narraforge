import io
import wave
from unittest.mock import patch

from app.core import config


def _silent_wav_bytes(duration_ms: int = 50) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setparams((1, 2, 16000, 0, "NONE", "NONE"))
        frames = int(16000 * duration_ms / 1000)
        w.writeframes(b"\x00\x00" * frames)
    return buf.getvalue()


def _payload(pid: str = "p1") -> dict:
    return {
        "id": pid, "name": "Test", "schema_version": 2, "layout": "vertical",
        "chapters": [{
            "id": "c1", "position": 0, "name": "第一章", "engine": "edge_tts",
            "default_params": {"engine": "edge_tts", "voice_id": "v1"},
            "split_config": {"delimiters": ["。"], "mode": "rule"},
            "original_text": "全文",
            "segments": [{
                "id": "s1", "position": 0, "text": "hello",
                "params": {"engine": "edge_tts"}, "locked_params": [],
            }],
        }],
    }


def test_crud_round_trip(client, tmp_path, monkeypatch):
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)

    r = client.post("/api/segmented-projects", json=_payload("p1"))
    assert r.status_code == 201, r.text
    assert r.json()["chapters"][0]["segments"][0]["text"] == "hello"

    r = client.get("/api/segmented-projects")
    assert r.status_code == 200
    assert {p["id"] for p in r.json()} == {"p1"}

    r = client.get("/api/segmented-projects/p1")
    assert r.status_code == 200
    assert r.json()["chapters"][0]["original_text"] == "全文"

    payload = _payload("p1")
    payload["chapters"][0]["segments"] = []
    r = client.put("/api/segmented-projects/p1", json=payload)
    assert r.status_code == 200
    assert r.json()["chapters"][0]["segments"] == []

    r = client.delete("/api/segmented-projects/p1")
    assert r.status_code == 204


def test_404_on_missing(client):
    r = client.get("/api/segmented-projects/nope")
    assert r.status_code == 404


def test_synthesize_endpoint_writes_audio(client, tmp_path, monkeypatch):
    from app.core.audio_encoder import is_ffmpeg_available
    if not is_ffmpeg_available():
        import pytest
        pytest.skip("ffmpeg not installed")
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    client.post("/api/segmented-projects", json=_payload("p1"))
    fake = _silent_wav_bytes()
    with patch(
        "app.services.segmented_project_service.synthesize_with_engine",
        return_value=(fake, "wav"),
    ):
        r = client.post(
            "/api/segmented-projects/p1/chapters/c1/segments/s1/synthesize",
            json={"params": {"engine": "edge_tts", "voice_id": "v1"}},
        )
    assert r.status_code == 200, r.text
    seg = r.json()["chapters"][0]["segments"][0]
    assert seg["current_audio_path"].endswith(".mp3")
    assert seg["audio_format"] == "mp3"
    full = tmp_path / seg["current_audio_path"]
    assert full.exists()


def test_migrate_endpoint_creates_projects(client, tmp_path, monkeypatch):
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    payload = _payload("p-mig")
    r = client.post("/api/segmented-projects/migrate",
                    json={"projects": [payload], "audios": []})
    assert r.status_code == 200
    assert r.json()["results"][0]["status"] == "ok"
    r = client.get("/api/segmented-projects")
    assert {p["id"] for p in r.json()} == {"p-mig"}


def test_project_round_trips_role_and_prosody_fields(client, tmp_path, monkeypatch):
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    payload = _payload("p-role")
    payload["default_narrator_role_id"] = "role-narrator"
    payload["default_narrator_snapshot"] = {
        "id": "role-narrator",
        "name": "旁白",
        "default_engine": "edge_tts",
        "default_voice": "zh-CN-YunjianNeural",
        "default_engine_params": {"engine": "edge_tts", "edge_voice": "zh-CN-YunjianNeural"},
    }
    payload["chapters"][0]["segments"][0].update({
        "role_id": "role-linxia",
        "role_snapshot": {
            "id": "role-linxia",
            "name": "林夏",
            "default_engine": "edge_tts",
            "default_voice": "zh-CN-XiaoxiaoNeural",
            "default_engine_params": {"engine": "edge_tts", "edge_voice": "zh-CN-XiaoxiaoNeural"},
        },
        "segment_kind": "dialogue",
        "prosody_marks": [
            {
                "id": "mark-1",
                "start": 0,
                "end": 2,
                "emotion": "sad",
                "style_tags": ["low_voice", "slow"],
                "instruction": "压低声音",
                "intensity": 0.7,
            }
        ],
    })

    created = client.post("/api/segmented-projects", json=payload)
    assert created.status_code == 201, created.text

    fetched = client.get("/api/segmented-projects/p-role")
    assert fetched.status_code == 200
    body = fetched.json()
    assert body["default_narrator_role_id"] == "role-narrator"
    assert body["default_narrator_snapshot"]["name"] == "旁白"
    segment = body["chapters"][0]["segments"][0]
    assert segment["role_id"] == "role-linxia"
    assert segment["role_snapshot"]["name"] == "林夏"
    assert segment["segment_kind"] == "dialogue"
    assert segment["prosody_marks"][0]["style_tags"] == ["low_voice", "slow"]
