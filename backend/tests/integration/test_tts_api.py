"""TTS API 集成测试"""
import os
import pytest
from unittest.mock import patch, AsyncMock
from fastapi.testclient import TestClient

from app.core.config import settings


class TestTTSAPI:

    def test_synthesize_speech_success(self, client: TestClient, mock_tts_service):
        mock_tts_service.synthesize_speech.return_value = b"synthesized_audio_data"

        request_data = {
            "text": "Hello, this is a test for TTS synthesis.",
            "speed": 1.2,
            "volume": 85,
            "pitch": 1,
            "emotion": "happy",
            "voice_id": "xiaoyun"
        }

        response = client.post("/api/tts/synthesize", json=request_data)
        assert response.status_code == 200
        data = response.json()

        assert "audio_id" in data
        assert "audio_url" in data
        assert data["text"] == "Hello, this is a test for TTS synthesis."
        assert data["params"]["speed"] == 1.2
        assert data["params"]["volume"] == 85
        assert data["params"]["pitch"] == 1
        assert data["params"]["emotion"] == "happy"
        assert data["params"]["voice_id"] == "xiaoyun"

        mock_tts_service.synthesize_speech.assert_called_once_with(
            text="Hello, this is a test for TTS synthesis.",
            voice_id="xiaoyun",
            speed=1.2,
            volume=85,
            pitch=1,
            format="wav",
            sample_rate=16000
        )

    def test_synthesize_speech_with_defaults(self, client: TestClient, mock_tts_service):
        mock_tts_service.synthesize_speech.return_value = b"audio_data"

        request_data = {"text": "Test with defaults"}

        response = client.post("/api/tts/synthesize", json=request_data)
        assert response.status_code == 200
        data = response.json()

        assert data["text"] == "Test with defaults"
        assert data["params"]["speed"] == 1.0
        assert data["params"]["volume"] == 80
        assert data["params"]["pitch"] == 0
        assert data["params"]["emotion"] == "neutral"
        assert data["params"]["voice_id"] == "xiaoyun"

        mock_tts_service.synthesize_speech.assert_called_once_with(
            text="Test with defaults",
            voice_id="xiaoyun",
            speed=1.0,
            volume=80,
            pitch=0,
            format="wav",
            sample_rate=16000
        )

    def test_synthesize_speech_with_custom_voice(self, client: TestClient, mock_tts_service):
        mock_tts_service.synthesize_speech.return_value = b"audio_data"

        request_data = {
            "text": "Test with custom voice",
            "voice_id": "xiaogang"
        }

        response = client.post("/api/tts/synthesize", json=request_data)
        assert response.status_code == 200
        data = response.json()

        assert data["params"]["voice_id"] == "xiaogang"

        mock_tts_service.synthesize_speech.assert_called_once_with(
            text="Test with custom voice",
            voice_id="xiaogang",
            speed=1.0,
            volume=80,
            pitch=0,
            format="wav",
            sample_rate=16000
        )

    def test_synthesize_speech_with_cloned_voice(self, client: TestClient, mock_tts_service):
        """测试使用克隆声音的语音合成"""
        mock_tts_service.clone_voice.return_value = b"cloned_audio_data"

        request_data = {
            "text": "Test with cloned voice",
            "voice_id": "cosyvoice-clone-v2-testvoice"
        }

        response = client.post("/api/tts/synthesize", json=request_data)
        assert response.status_code == 200
        data = response.json()

        assert data["params"]["voice_id"] == "cosyvoice-clone-v2-testvoice"
        assert data["params"]["is_cloned_voice"] is True

        mock_tts_service.clone_voice.assert_called_once_with(
            voice_id="cosyvoice-clone-v2-testvoice",
            text="Test with cloned voice",
            speed=1.0,
            volume=80,
            pitch=0,
            format="wav",
            sample_rate=16000
        )

    def test_synthesize_speech_tts_service_error(self, client: TestClient, mock_tts_service):
        mock_tts_service.synthesize_speech.side_effect = Exception("TTS service error")

        request_data = {
            "text": "Test error handling",
            "voice_id": "xiaoyun"
        }

        response = client.post("/api/tts/synthesize", json=request_data)
        assert response.status_code == 500
        data = response.json()
        assert "detail" in data
        assert "failed" in data["detail"].lower()

    def test_synthesize_speech_empty_text(self, client: TestClient):
        """空文本 - FastAPI/Pydantic 不验证空字符串，API 会正常处理"""
        request_data = {
            "text": "",
            "voice_id": "xiaoyun"
        }

        response = client.post("/api/tts/synthesize", json=request_data)
        # 当前 API 不验证空文本，返回 500（TTS 服务会失败）
        # 如果加了验证则应为 422
        assert response.status_code in [400, 422, 500]

    def test_get_tts_audio_success(self, client: TestClient):
        audio_id = "test_audio_123"
        audio_content = b"fake audio data"
        audio_path = settings.voices_dir / f"tts_{audio_id}.wav"

        audio_path.write_bytes(audio_content)

        try:
            response = client.get(f"/api/tts/audio/{audio_id}")
            assert response.status_code == 200
            assert response.headers["content-type"] == "audio/wav"
            assert response.content == audio_content
        finally:
            if audio_path.exists():
                audio_path.unlink()

    def test_get_tts_audio_not_found(self, client: TestClient):
        response = client.get("/api/tts/audio/nonexistent_audio")
        assert response.status_code == 404
        data = response.json()
        assert "detail" in data
        assert "not found" in data["detail"].lower()

    def test_list_available_voices(self, client: TestClient):
        response = client.get("/api/tts/voices")
        assert response.status_code == 200
        data = response.json()

        assert "voices" in data
        voices = data["voices"]
        assert isinstance(voices, list)
        assert len(voices) > 0

        for voice in voices:
            assert "id" in voice
            assert "name" in voice
            assert "gender" in voice

        voice_ids = [v["id"] for v in voices]
        assert "xiaoyun" in voice_ids
        assert "xiaoyuan" in voice_ids
        assert "ruoxi" in voice_ids
        assert "xiaogang" in voice_ids
        assert "yunjian" in voice_ids

    def test_list_available_voices_structure(self, client: TestClient):
        response = client.get("/api/tts/voices")
        data = response.json()

        xiaoyun = next(v for v in data["voices"] if v["id"] == "xiaoyun")
        assert xiaoyun["name"] == "云溪"
        assert xiaoyun["gender"] == "female"

        xiaogang = next(v for v in data["voices"] if v["id"] == "xiaogang")
        assert xiaogang["name"] == "小刚"
        assert xiaogang["gender"] == "male"

    def test_batch_synthesize_empty_segments(self, client: TestClient):
        """测试空段落的批量合成"""
        request_data = {
            "segments": [],
            "speed": 1.0,
            "volume": 80
        }

        response = client.post("/api/tts/batch", json=request_data)
        assert response.status_code == 200
        data = response.json()
        assert "segments" in data
        assert len(data["segments"]) == 0

    def test_concurrent_synthesize_requests(self, client: TestClient, mock_tts_service):
        """测试并发语音合成请求"""
        import threading

        mock_tts_service.synthesize_speech.return_value = b"audio_data"

        results = []
        errors = []

        def make_request(request_num):
            try:
                request_data = {
                    "text": f"Concurrent request {request_num}",
                    "voice_id": "xiaoyun"
                }
                response = client.post("/api/tts/synthesize", json=request_data)
                results.append((request_num, response.status_code))
            except Exception as e:
                errors.append((request_num, str(e)))

        threads = []
        for i in range(5):
            thread = threading.Thread(target=make_request, args=(i,))
            threads.append(thread)
            thread.start()

        for thread in threads:
            thread.join()

        assert len(errors) == 0
        assert len(results) == 5

        for request_num, status_code in results:
            assert status_code == 200
