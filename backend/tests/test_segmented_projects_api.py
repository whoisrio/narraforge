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
            "voice": {"engine": "edge_tts", "voice_id": "v1"},
            "split_config": {"delimiters": ["。"], "mode": "rule"},
            "original_text": "全文",
            "segments": [{
                "id": "s1", "position": 0, "text": "hello",
                "voice": {"source": "chapter"},
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


def test_list_projects_includes_card_summary_stats(client, tmp_path, monkeypatch):
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    payload = _payload("p-stats")
    payload["chapters"].append({
        "id": "c2", "position": 1, "name": "第二章", "engine": "edge_tts",
        "voice": {"engine": "edge_tts", "voice_id": "v1"},
        "split_config": {"delimiters": ["。"], "mode": "rule"},
        "segments": [
            {"id": "s2", "position": 0, "text": "ready", "voice": {"source": "chapter"},
             "audio": {"current": {"path": "p/c2/s2.mp3", "format": "mp3", "duration_sec": 3.4}}},
            {"id": "s3", "position": 1, "text": "idle", "voice": {"source": "chapter"}},
        ],
    })
    payload["chapters"][0]["segments"][0]["audio"] = {"current": {"path": "p/c1/s1.mp3", "format": "mp3", "duration_sec": 2.2}}

    created = client.post("/api/segmented-projects", json=payload)
    assert created.status_code == 201, created.text

    r = client.get("/api/segmented-projects")
    assert r.status_code == 200
    summary = r.json()[0]
    assert summary["summary_stats"] == {
        "chapter_count": 2,
        "segment_count": 3,
        "generated_count": 2,
        "duration_sec": 5.6,
    }


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
    audio = seg.get("audio") or {}
    current = audio.get("current", {}) if isinstance(audio, dict) else {}
    assert current.get("path", "").endswith(".mp3")
    assert current.get("format") == "mp3"
    full = tmp_path / current["path"]
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


def test_project_round_trips_role_fields(client, tmp_path, monkeypatch):
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)
    payload = _payload("p-role")
    payload["default_narrator_role_id"] = "role-narrator"
    payload["chapters"][0]["segments"][0].update({
        "role_id": "role-linxia",
        "segment_kind": "dialogue",
        "voice": {
            "source": "role",
            "name": "林夏",
            "engine": "edge_tts",
            "role_id": "role-linxia",
        },
    })

    created = client.post("/api/segmented-projects", json=payload)
    assert created.status_code == 201, created.text

    fetched = client.get("/api/segmented-projects/p-role")
    assert fetched.status_code == 200
    body = fetched.json()
    assert body["default_narrator_role_id"] == "role-narrator"
    segment = body["chapters"][0]["segments"][0]
    assert segment["role_id"] == "role-linxia"
    assert segment["segment_kind"] == "dialogue"
    assert segment["voice"]["source"] == "role"
    assert segment["voice"]["name"] == "林夏"


def test_project_configs_json_round_trips_ui_settings(client, tmp_path, monkeypatch):
    """Regression: project UI settings (description / export_directory) are stored in the
    free-form `configs` JSON bucket, not dedicated columns. Verify create → get → list → put
    all preserve those keys, and that `configs=None` on PUT clears them.
    """
    monkeypatch.setattr(config.settings, "segmented_dir", tmp_path)

    payload = _payload("p-cfg")
    payload["remotion_project_path"] = "/tmp/remotion"
    payload["configs"] = {
        "description": "给 DeepSeek 视频做旁白",
        "export_directory": "public/narration",
        "split_voice_mode": "dialogue",
    }

    created = client.post("/api/segmented-projects", json=payload)
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["remotion_project_path"] == "/tmp/remotion"
    assert body["configs"] == {
        "description": "给 DeepSeek 视频做旁白",
        "export_directory": "public/narration",
        "split_voice_mode": "dialogue",
    }

    fetched = client.get("/api/segmented-projects/p-cfg").json()
    assert fetched["configs"]["description"] == "给 DeepSeek 视频做旁白"
    assert fetched["configs"]["export_directory"] == "public/narration"
    assert fetched["configs"]["split_voice_mode"] == "dialogue"

    # PUT with a modified configs value replaces (full-state save).
    payload["configs"] = {"export_directory": "assets/audio"}
    updated = client.put("/api/segmented-projects/p-cfg", json=payload).json()
    assert updated["configs"] == {"export_directory": "assets/audio"}

    # PUT with configs=None clears.
    payload["configs"] = None
    cleared = client.put("/api/segmented-projects/p-cfg", json=payload).json()
    assert cleared["configs"] is None
