"""TTS API 集成测试"""
import threading
from pathlib import Path

from fastapi.testclient import TestClient

from app.core.system_config_service import set_storage_mode
from app.models.voice_profile import VoiceProfile


def _write_audio_file(tmp_path: Path, name: str = "audio.wav") -> str:
    path = tmp_path / name
    path.write_bytes(b"RIFF\x24\x00\x00\x00WAVEfmt ")
    return str(path)


class TestTTSAPI:

    def test_synthesize_speech_success_frontend_storage(self, client: TestClient, mock_tts_service, tmp_path):
        audio_path = _write_audio_file(tmp_path, "success.wav")
        mock_tts_service.synthesize_speech.return_value = audio_path

        request_data = {
            "text": "Hello, this is a test for TTS synthesis.",
            "voice_id": "cosyvoice-v3-test",
            "instruction": "clear narration",
            "speed": 1.2,
            "volume": 85,
            "pitch": 1.0,
        }

        response = client.post("/api/tts/synthesize", json=request_data)
        assert response.status_code == 200
        data = response.json()

        assert data["audio_id"] == "success"
        assert "audio_base64" in data
        assert data["audio_format"] == "wav"
        assert data["text"] == request_data["text"]
        assert data["params"]["speed"] == 1.2
        assert data["params"]["volume"] == 85
        assert data["params"]["pitch"] == 1.0
        assert data["params"]["voice_id"] == "cosyvoice-v3-test"

        mock_tts_service.synthesize_speech.assert_called_once_with(
            voice_id="cosyvoice-v3-test",
            text=request_data["text"],
            speed=1.2,
            volume=85,
            pitch=1.0,
            format="wav",
            sample_rate=16000,
            instruction="clear narration",
            enable_ssml=False,
            enable_markdown_filter=False,
        )
        assert not Path(audio_path).exists()

    def test_synthesize_speech_requires_voice_id(self, client: TestClient, mock_tts_service):
        response = client.post("/api/tts/synthesize", json={"text": "Test with defaults"})
        assert response.status_code == 400
        assert "voice_id" in response.json()["detail"]["message"]

    def test_synthesize_speech_with_custom_voice(self, client: TestClient, mock_tts_service, tmp_path):
        mock_tts_service.synthesize_speech.return_value = _write_audio_file(tmp_path, "custom.wav")

        response = client.post("/api/tts/synthesize", json={
            "text": "Test with custom voice",
            "voice_id": "xiaogang",
        })
        assert response.status_code == 200
        data = response.json()
        assert data["params"]["voice_id"] == "xiaogang"

    def test_synthesize_speech_backend_storage_returns_audio_url(self, client: TestClient, db_session, mock_tts_service, tmp_path):
        set_storage_mode(db_session, "backend")
        db_session.commit()
        audio_path = _write_audio_file(tmp_path, "backend.wav")
        mock_tts_service.synthesize_speech.return_value = audio_path

        response = client.post("/api/tts/synthesize", json={
            "text": "Backend storage",
            "voice_id": "cosyvoice-v3-test",
        })
        assert response.status_code == 200
        data = response.json()
        assert data["audio_id"] == "backend"
        assert data["audio_url"] == "/api/tts/audio/backend"
        # Backend mode returns audio_url; audio_base64 is null (response_model
        # always serializes the schema field, previously it was omitted).
        assert data["audio_base64"] is None

    def test_synthesize_speech_tts_service_error(self, client: TestClient, mock_tts_service):
        mock_tts_service.synthesize_speech.side_effect = Exception("TTS service error")

        response = client.post("/api/tts/synthesize", json={
            "text": "Test error handling",
            "voice_id": "xiaoyun",
        })
        assert response.status_code == 500
        data = response.json()
        assert "detail" in data
        assert "failed" in data["detail"]["message"].lower()

    def test_synthesize_speech_empty_text(self, client: TestClient):
        response = client.post("/api/tts/synthesize", json={
            "text": "",
            "voice_id": "xiaoyun",
        })
        assert response.status_code in [400, 422, 500]

    def test_get_tts_audio_success(self, client: TestClient, db_session, tmp_path):
        from app.models.tts_result import TTSResultRecord

        audio_content = b"fake audio data"
        audio_path = tmp_path / "test_audio.wav"
        audio_path.write_bytes(audio_content)
        record = TTSResultRecord(
            id="test_audio_123",
            text="hello",
            voice_id="v1",
            voice_name="Voice",
            audio_path=str(audio_path),
            audio_format="wav",
        )
        db_session.add(record)
        db_session.commit()

        response = client.get("/api/tts/audio/test_audio_123")
        assert response.status_code == 200
        assert response.headers["content-type"] == "audio/wav"
        assert response.content == audio_content

    def test_get_tts_audio_not_found(self, client: TestClient):
        response = client.get("/api/tts/audio/nonexistent_audio")
        assert response.status_code == 404
        data = response.json()
        assert "detail" in data
        assert "not found" in data["detail"]["message"].lower()

    def test_list_available_voices_empty(self, client: TestClient):
        response = client.get("/api/tts/voices")
        assert response.status_code == 200
        assert response.json() == {"items": []}

    def test_list_available_voices_with_cloned_qwen_voice(self, client: TestClient, db_session):
        voice = VoiceProfile(
            id="voice-row-1",
            name="Narrator",
            voice={"model": "cosyvoice", "voice_type": "clone"},
            voice_params={"cosyvoice": {"source_audio_path": "/tmp/narrator.wav", "params": {"voice_id": "cosyvoice-v3-narrator"}}},
        )
        db_session.add(voice)
        db_session.commit()

        response = client.get("/api/tts/voices")
        assert response.status_code == 200
        voices = response.json()["items"]
        assert len(voices) == 1
        assert voices[0]["id"] == "voice-row-1"
        assert voices[0]["voice_params"]["cosyvoice"]["params"]["voice_id"] == "cosyvoice-v3-narrator"
        assert voices[0]["voice"]["model"] == "cosyvoice"

    def test_batch_synthesize_requires_voice_id(self, client: TestClient):
        response = client.post("/api/tts/batch", json={
            "segments": [],
            "speed": 1.0,
            "volume": 80,
        })
        assert response.status_code == 422

    def test_concurrent_synthesize_requests(self, client: TestClient, mock_tts_service, tmp_path):
        paths = [_write_audio_file(tmp_path, f"audio_{i}.wav") for i in range(5)]
        mock_tts_service.synthesize_speech.side_effect = paths

        results = []
        errors = []

        def make_request(request_num):
            try:
                response = client.post("/api/tts/synthesize", json={
                    "text": f"Concurrent request {request_num}",
                    "voice_id": "xiaoyun",
                })
                results.append((request_num, response.status_code))
            except Exception as e:
                errors.append((request_num, str(e)))

        threads = [threading.Thread(target=make_request, args=(i,)) for i in range(5)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()

        assert len(errors) == 0
        assert len(results) == 5
        for _, status_code in results:
            assert status_code == 200


# TTSResultOut response_model contract (B-P1-8): every synthesize response
# includes the required audio_id + text + params, plus the optional schema
# fields (serialized as null when unset, e.g. backend mode has no audio_base64).
TTS_RESULT_FIELDS = {"audio_id", "text", "params", "audio_base64", "audio_url",
                     "audio_format", "voice_id", "voice_name", "engine"}


class TestTTSResultContract:
    def test_synthesize_response_has_full_contract(self, client: TestClient, mock_tts_service, tmp_path):
        audio_path = _write_audio_file(tmp_path, "contract.wav")
        mock_tts_service.synthesize_speech.return_value = audio_path
        response = client.post("/api/tts/synthesize", json={
            "text": "contract check", "voice_id": "cosyvoice-v3-test",
        })
        assert response.status_code == 200
        data = response.json()
        assert TTS_RESULT_FIELDS.issubset(data.keys())
        # required fields are non-null
        assert data["audio_id"]
        assert data["text"] == "contract check"
        assert isinstance(data["params"], dict)

    def test_history_response_has_results_wrapper(self, client: TestClient, db_session):
        from app.models.tts_result import TTSResultRecord
        db_session.add(TTSResultRecord(
            id="h1", text="hi", voice_id="v1", voice_name="n", audio_path="p",
            audio_format="mp3", speed=1.0, volume=80, pitch=1.0,
            instruction="", language="Chinese",
        ))
        db_session.commit()
        response = client.get("/api/tts/history")
        assert response.status_code == 200
        data = response.json()
        assert "items" in data
        item = next(i for i in data["items"] if i["id"] == "h1")
        for f in ("id", "text", "voice_id", "voice_name", "audio_url",
                  "audio_format", "speed", "volume", "pitch", "created_at"):
            assert f in item


def test_mimo_preset_response_contract(client: TestClient, monkeypatch):
    """mimo /preset 走独立的 _save_and_respond 路径，也要满足 TTSResultOut 契约."""
    import app.api.mimo_tts as mimo_api

    class FakeMimoService:
        async def synthesize_preset(self, **kwargs):
            return b"fake mimo audio"

    async def fake_get_service(db=None):
        return FakeMimoService()

    monkeypatch.setattr(mimo_api, "get_mimo_tts_service", fake_get_service)

    response = client.post("/api/mimo-tts/preset", json={"text": "hi", "voice": "冰糖"})
    assert response.status_code == 200, response.text
    data = response.json()
    assert TTS_RESULT_FIELDS.issubset(data.keys())
    assert data["audio_id"]
    assert data["text"] == "hi"
    assert isinstance(data["params"], dict)


def test_voxcpm_tts_response_contract(client: TestClient, monkeypatch):
    """voxcpm /tts 顶层带 engine，也要满足 TTSResultOut 契约."""
    import app.api.voxcpm as voxcpm_api

    class FakeVoxcpmService:
        loaded = True
        async def synthesize(self, **kwargs):
            return b"fake wav bytes"
        async def load_model(self):
            return {"success": True}

    async def fake_get_service():
        return FakeVoxcpmService()

    monkeypatch.setattr(voxcpm_api, "get_voxcpm_service", fake_get_service)

    response = client.post("/api/voxcpm/tts", json={"text": "hi"})
    assert response.status_code == 200, response.text
    data = response.json()
    assert TTS_RESULT_FIELDS.issubset(data.keys())
    assert data["audio_id"]
    assert data["text"] == "hi"
    assert isinstance(data["params"], dict)
    # voxcpm is the one engine that surfaces a top-level `engine`.
    assert data["engine"]
