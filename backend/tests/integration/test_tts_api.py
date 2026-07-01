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
        assert "voice_id" in response.json()["detail"]

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
        assert "audio_base64" not in data

    def test_synthesize_speech_tts_service_error(self, client: TestClient, mock_tts_service):
        mock_tts_service.synthesize_speech.side_effect = Exception("TTS service error")

        response = client.post("/api/tts/synthesize", json={
            "text": "Test error handling",
            "voice_id": "xiaoyun",
        })
        assert response.status_code == 500
        data = response.json()
        assert "detail" in data
        assert "failed" in data["detail"].lower()

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
        assert "not found" in data["detail"].lower()

    def test_list_available_voices_empty(self, client: TestClient):
        response = client.get("/api/tts/voices")
        assert response.status_code == 200
        assert response.json() == {"voices": []}

    def test_list_available_voices_with_cloned_qwen_voice(self, client: TestClient, db_session):
        voice = VoiceProfile(
            id="voice-row-1",
            name="Narrator",
            source_audio_path="/tmp/narrator.wav",
            engine={
                "type": "qwen",
                "is_cloned": True,
                "qwen_voice_id": "cosyvoice-v3-narrator",
            },
        )
        db_session.add(voice)
        db_session.commit()

        response = client.get("/api/tts/voices")
        assert response.status_code == 200
        voices = response.json()["voices"]
        assert len(voices) == 1
        assert voices[0]["id"] == "voice-row-1"
        assert voices[0]["engine"]["qwen_voice_id"] == "cosyvoice-v3-narrator"
        assert voices[0]["engine"]["type"] == "qwen"

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
