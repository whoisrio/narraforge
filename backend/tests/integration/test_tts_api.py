"""
TTS API 集成测试
"""
import pytest
import json
from unittest.mock import patch, AsyncMock
from fastapi.testclient import TestClient


class TestTTSAPI:
    """TTS API 测试类"""

    def test_synthesize_speech_success(self, client: TestClient, mock_tts_service):
        """测试语音合成成功"""
        # 配置模拟服务
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

        # 验证模拟服务被调用
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
        """测试使用默认参数的语音合成"""
        mock_tts_service.synthesize_speech.return_value = b"audio_data"

        request_data = {
            "text": "Test with defaults"
        }

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
        """测试使用自定义声音的语音合成"""
        mock_tts_service.synthesize_speech.return_value = b"audio_data"

        request_data = {
            "text": "Test with custom voice",
            "voice_id": "xiaogang"  # 男性声音
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

    def test_synthesize_speech_empty_text(self, client: TestClient):
        """测试空文本的语音合成"""
        request_data = {
            "text": "",
            "voice_id": "xiaoyun"
        }

        response = client.post("/api/tts/synthesize", json=request_data)
        # 可能是 422（验证错误）或 400（业务逻辑错误）
        assert response.status_code in [400, 422]

    def test_synthesize_speech_long_text(self, client: TestClient, mock_tts_service):
        """测试长文本的语音合成"""
        mock_tts_service.synthesize_speech.return_value = b"audio_data"

        long_text = "这是一个很长的文本，" * 50  # 创建长文本
        request_data = {
            "text": long_text,
            "voice_id": "xiaoyun"
        }

        response = client.post("/api/tts/synthesize", json=request_data)
        assert response.status_code == 200

        # 验证服务被调用
        mock_tts_service.synthesize_speech.assert_called_once()
        call_args = mock_tts_service.synthesize_speech.call_args
        assert call_args[1]["text"] == long_text

    def test_synthesize_speech_tts_service_error(self, client: TestClient, mock_tts_service):
        """测试 TTS 服务错误"""
        # 模拟服务抛出异常
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

    def test_batch_synthesize_success(self, client: TestClient, mock_tts_service):
        """测试批量语音合成成功"""
        mock_tts_service.synthesize_speech.return_value = b"batch_audio_data"

        request_data = {
            "segments": [
                {
                    "text": "First segment text.",
                    "start_time": 0.0,
                    "end_time": 2.0
                },
                {
                    "text": "Second segment text.",
                    "start_time": 2.0,
                    "end_time": 4.0
                },
                {
                    "text": "Third segment text.",
                    "start_time": 4.0,
                    "end_time": 6.0
                }
            ],
            "speed": 1.1,
            "volume": 75,
            "pitch": -1,
            "emotion": "calm"
        }

        response = client.post("/api/tts/batch", json=request_data)
        assert response.status_code == 200
        data = response.json()

        assert "segments" in data
        segments = data["segments"]
        assert len(segments) == 3

        # 验证每个段落的响应
        for i, segment in enumerate(segments):
            assert "audio_id" in segment
            assert "audio_url" in segment
            assert "text" in segment
            assert "start_time" in segment
            assert "end_time" in segment

            # 验证文本匹配
            expected_text = request_data["segments"][i]["text"]
            assert segment["text"] == expected_text

        # 验证模拟服务被调用正确的次数
        assert mock_tts_service.synthesize_speech.call_count == 3

        # 验证参数
        for call in mock_tts_service.synthesize_speech.call_args_list:
            kwargs = call[1]
            assert kwargs["speed"] == 1.1
            assert kwargs["volume"] == 75
            assert kwargs["pitch"] == -1
            assert kwargs["voice_id"] == "xiaoyun"  # 批量使用默认声音

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

    def test_batch_synthesize_with_defaults(self, client: TestClient, mock_tts_service):
        """测试使用默认参数的批量合成"""
        mock_tts_service.synthesize_speech.return_value = b"audio_data"

        request_data = {
            "segments": [
                {
                    "text": "Test segment",
                    "start_time": 0.0,
                    "end_time": 1.0
                }
            ]
        }

        response = client.post("/api/tts/batch", json=request_data)
        assert response.status_code == 200

        # 验证默认参数
        mock_tts_service.synthesize_speech.assert_called_once_with(
            text="Test segment",
            voice_id="xiaoyun",
            speed=1.0,
            volume=80,
            pitch=0,
            format="wav",
            sample_rate=16000
        )

    def test_batch_synthesize_tts_service_error(self, client: TestClient, mock_tts_service):
        """测试批量合成时 TTS 服务错误"""
        # 模拟第一次成功，第二次失败
        mock_tts_service.synthesize_speech.side_effect = [
            b"audio_data_1",
            Exception("TTS error on second segment"),
            b"audio_data_3"  # 不会执行到这里
        ]

        request_data = {
            "segments": [
                {"text": "Segment 1", "start_time": 0.0, "end_time": 1.0},
                {"text": "Segment 2", "start_time": 1.0, "end_time": 2.0},
                {"text": "Segment 3", "start_time": 2.0, "end_time": 3.0}
            ]
        }

        response = client.post("/api/tts/batch", json=request_data)
        assert response.status_code == 500
        data = response.json()
        assert "detail" in data
        assert "failed" in data["detail"].lower()

    def test_get_tts_audio_success(self, client: TestClient):
        """测试获取 TTS 音频文件成功"""
        import tempfile
        import os

        # 创建测试音频文件
        audio_id = "test_audio_123"
        audio_content = b"fake audio data"

        # 将文件保存到测试目录
        audio_path = client.app.state.settings.voices_dir / f"tts_{audio_id}.wav"
        with open(audio_path, "wb") as f:
            f.write(audio_content)

        try:
            response = client.get(f"/api/tts/audio/{audio_id}")
            assert response.status_code == 200
            assert response.headers["content-type"] == "audio/wav"
            assert response.content == audio_content
        finally:
            # 清理
            if os.path.exists(audio_path):
                os.unlink(audio_path)

    def test_get_tts_audio_not_found(self, client: TestClient):
        """测试获取不存在的 TTS 音频"""
        response = client.get("/api/tts/audio/nonexistent_audio")
        assert response.status_code == 404
        data = response.json()
        assert "detail" in data
        assert "not found" in data["detail"].lower()

    def test_list_available_voices(self, client: TestClient):
        """测试获取可用声音列表"""
        response = client.get("/api/tts/voices")
        assert response.status_code == 200
        data = response.json()

        assert "voices" in data
        voices = data["voices"]
        assert isinstance(voices, list)
        assert len(voices) > 0

        # 验证每个声音的结构
        for voice in voices:
            assert "id" in voice
            assert "name" in voice
            assert "gender" in voice

        # 验证特定声音存在
        voice_ids = [v["id"] for v in voices]
        assert "xiaoyun" in voice_ids
        assert "xiaoyuan" in voice_ids
        assert "ruoxi" in voice_ids
        assert "xiaogang" in voice_ids
        assert "yunjian" in voice_ids

    def test_list_available_voices_structure(self, client: TestClient):
        """测试声音列表的结构"""
        response = client.get("/api/tts/voices")
        data = response.json()

        # 检查一个示例声音
        xiaoyun = next(v for v in data["voices"] if v["id"] == "xiaoyun")
        assert xiaoyun["name"] == "云溪"
        assert xiaoyun["gender"] == "female"

        xiaogang = next(v for v in data["voices"] if v["id"] == "xiaogang")
        assert xiaogang["name"] == "小刚"
        assert xiaogang["gender"] == "male"

    @pytest.mark.parametrize("invalid_data", [
        {},  # 空对象
        {"text": ""},  # 空文本
        {"text": "a" * 10001},  # 超长文本
        {"text": "test", "speed": 0},  # 无效语速
        {"text": "test", "speed": 3.0},  # 超快语速
        {"text": "test", "volume": -10},  # 无效音量
        {"text": "test", "volume": 110},  # 超音量
        {"text": "test", "pitch": -13},  # 无效音调
        {"text": "test", "pitch": 13},  # 超音调
    ])
    def test_synthesize_speech_invalid_parameters(self, client: TestClient, invalid_data):
        """测试使用无效参数的语音合成"""
        response = client.post("/api/tts/synthesize", json=invalid_data)
        # 可能是 422（验证错误）或 400（业务逻辑错误）
        assert response.status_code in [400, 422]

    @pytest.mark.parametrize("invalid_segment", [
        {"text": "", "start_time": 0.0, "end_time": 1.0},  # 空文本
        {"text": "test", "start_time": -1.0, "end_time": 1.0},  # 负开始时间
        {"text": "test", "start_time": 2.0, "end_time": 1.0},  # 结束时间早于开始时间
        {"text": "test", "start_time": 0.0, "end_time": 0.0},  # 零时长
    ])
    def test_batch_synthesize_invalid_segments(self, client: TestClient, invalid_segment):
        """测试使用无效段落的批量合成"""
        request_data = {
            "segments": [invalid_segment],
            "speed": 1.0,
            "volume": 80
        }

        response = client.post("/api/tts/batch", json=request_data)
        # 可能是 422（验证错误）或 400（业务逻辑错误）
        assert response.status_code in [400, 422]

    def test_concurrent_synthesize_requests(self, client: TestClient, mock_tts_service):
        """测试并发语音合成请求"""
        import threading
        import time

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

        # 创建多个线程并发请求
        threads = []
        for i in range(5):
            thread = threading.Thread(target=make_request, args=(i,))
            threads.append(thread)
            thread.start()

        # 等待所有线程完成
        for thread in threads:
            thread.join()

        # 验证所有请求都成功
        assert len(errors) == 0
        assert len(results) == 5

        for request_num, status_code in results:
            assert status_code == 200