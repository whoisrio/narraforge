"""
Qwen TTS 服务单元测试
"""
import pytest
import base64
from unittest.mock import Mock, patch, AsyncMock
from typing import Dict, Any

from app.services.qwen_tts_service import QwenTTSService


class TestQwenTTSService:
    """QwenTTSService 测试类"""

    def test_service_initialization_without_api_key(self):
        """测试没有 API key 时的初始化"""
        with patch("app.services.qwen_tts_service.settings") as mock_settings:
            mock_settings.qwen_api_key = None

            with pytest.raises(ValueError, match="QWEN_API_KEY is not configured"):
                QwenTTSService()

    def test_service_initialization_with_api_key(self):
        """测试有 API key 时的初始化"""
        with patch("app.services.qwen_tts_service.settings") as mock_settings:
            mock_settings.qwen_api_key = "test_api_key_123"

            service = QwenTTSService()
            assert service.api_key == "test_api_key_123"

    def test_service_initialization_with_custom_api_key(self):
        """测试使用自定义 API key 初始化"""
        service = QwenTTSService(api_key="custom_api_key_456")
        assert service.api_key == "custom_api_key_456"

    def test_get_headers(self):
        """测试获取请求头"""
        with patch("uuid.uuid4") as mock_uuid:
            mock_uuid.return_value = "test-uuid-123"

            service = QwenTTSService(api_key="test_api_key")
            headers = service._get_headers()

            assert headers["Authorization"] == "Bearer test_api_key"
            assert headers["Content-Type"] == "application/json"
            assert headers["X-Request-Id"] == "test-uuid-123"

    @pytest.mark.asyncio
    async def test_synthesize_speech_success(self):
        """测试语音合成成功"""
        with patch("app.services.qwen_tts_service.settings") as mock_settings:
            mock_settings.qwen_api_key = "test_api_key"

            service = QwenTTSService()

            # 模拟音频数据
            mock_audio_data = b"fake_audio_data"
            base64_audio = base64.b64encode(mock_audio_data).decode("utf-8")

            # 模拟成功的 API 响应
            mock_response = {
                "code": "Success",
                "output": {
                    "audio": {
                        "data": base64_audio
                    }
                }
            }

            with patch.object(service, "_synthesize_speech_sync") as mock_sync:
                mock_sync.return_value = mock_audio_data

                result = await service.synthesize_speech(
                    text="Hello, world!",
                    voice_id="xiaoyun",
                    speed=1.0,
                    volume=80,
                    pitch=0,
                    format="wav",
                    sample_rate=16000,
                )

                assert result == mock_audio_data
                mock_sync.assert_called_once_with(
                    "Hello, world!", "xiaoyun", 1.0, 80, 0, "wav", 16000
                )

    @pytest.mark.asyncio
    async def test_synthesize_speech_with_defaults(self):
        """测试使用默认参数的语音合成"""
        with patch("app.services.qwen_tts_service.settings") as mock_settings:
            mock_settings.qwen_api_key = "test_api_key"

            service = QwenTTSService()

            with patch.object(service, "_synthesize_speech_sync") as mock_sync:
                mock_sync.return_value = b"audio_data"

                result = await service.synthesize_speech(
                    text="Test text"
                )

                mock_sync.assert_called_once_with(
                    "Test text", "xiaoyun", 1.0, 80, 0, "wav", 16000
                )

    @pytest.mark.asyncio
    async def test_clone_voice_success(self):
        """测试声音克隆成功"""
        with patch("app.services.qwen_tts_service.settings") as mock_settings:
            mock_settings.qwen_api_key = "test_api_key"

            service = QwenTTSService()

            mock_audio_data = b"cloned_audio_data"

            with patch.object(service, "_clone_voice_sync") as mock_sync:
                mock_sync.return_value = mock_audio_data

                result = await service.clone_voice(
                    voice_id="cloned_voice_123",
                    text="Hello from cloned voice!",
                    speed=1.2,
                    volume=90,
                    pitch=2,
                    format="mp3",
                    sample_rate=22050,
                )

                assert result == mock_audio_data
                mock_sync.assert_called_once_with(
                    "cloned_voice_123", "Hello from cloned voice!", 1.2, 90, 2, "mp3", 22050
                )

    @pytest.mark.asyncio
    async def test_register_cloned_voice_success(self):
        """测试注册克隆声音成功"""
        with patch("app.services.qwen_tts_service.settings") as mock_settings:
            mock_settings.qwen_api_key = "test_api_key"

            service = QwenTTSService()

            test_audio_path = "/tmp/test_audio.wav"
            expected_result = {
                "voice_id": "registered_voice_123",
                "voice_name": "Test Voice",
                "role": "custom"
            }

            with patch.object(service, "_register_cloned_voice_sync") as mock_sync:
                mock_sync.return_value = expected_result

                result = await service.register_cloned_voice(
                    reference_audio_path=test_audio_path,
                    voice_name="Test Voice"
                )

                assert result == expected_result
                mock_sync.assert_called_once_with(
                    test_audio_path, "Test Voice"
                )

    @pytest.mark.asyncio
    async def test_register_cloned_voice_with_default_name(self):
        """测试使用默认名称注册克隆声音"""
        with patch("app.services.qwen_tts_service.settings") as mock_settings:
            mock_settings.qwen_api_key = "test_api_key"

            service = QwenTTSService()

            with patch.object(service, "_register_cloned_voice_sync") as mock_sync:
                mock_sync.return_value = {
                    "voice_id": "test_voice",
                    "voice_name": "cloned_voice",
                    "role": "custom"
                }

                result = await service.register_cloned_voice(
                    reference_audio_path="/tmp/test.wav"
                )

                mock_sync.assert_called_once_with(
                    "/tmp/test.wav", "cloned_voice"
                )

    def test_wait_for_task_completion_success(self):
        """测试等待任务完成成功"""
        with patch("app.services.qwen_tts_service.settings") as mock_settings:
            mock_settings.qwen_api_key = "test_api_key"

            service = QwenTTSService()

            task_id = "test_task_123"
            success_response = {
                "output": {
                    "task_status": "SUCCEEDED",
                    "audio": {
                        "data": base64.b64encode(b"audio_data").decode("utf-8")
                    }
                }
            }

            with patch("urllib.request.urlopen") as mock_urlopen:
                mock_response = Mock()
                mock_response.read.return_value = bytes(
                    '{"output": {"task_status": "SUCCEEDED", "audio": {"data": "YXVkaW9fZGF0YQ=="}}}',
                    "utf-8"
                )
                mock_urlopen.return_value.__enter__.return_value = mock_response

                result = service._wait_for_task_completion(task_id, max_retries=1, delay=0)

                assert "output" in result
                assert result["output"]["task_status"] == "SUCCEEDED"

    def test_wait_for_task_completion_failed(self):
        """测试等待任务完成失败"""
        with patch("app.services.qwen_tts_service.settings") as mock_settings:
            mock_settings.qwen_api_key = "test_api_key"

            service = QwenTTSService()

            task_id = "test_task_123"
            failed_response = {
                "output": {
                    "task_status": "FAILED",
                    "message": "Task failed due to invalid input"
                }
            }

            with patch("urllib.request.urlopen") as mock_urlopen:
                mock_response = Mock()
                mock_response.read.return_value = bytes(
                    '{"output": {"task_status": "FAILED", "message": "Task failed due to invalid input"}}',
                    "utf-8"
                )
                mock_urlopen.return_value.__enter__.return_value = mock_response

                with pytest.raises(Exception, match="TTS task failed"):
                    service._wait_for_task_completion(task_id, max_retries=1, delay=0)

    def test_wait_for_task_completion_timeout(self):
        """测试等待任务超时"""
        with patch("app.services.qwen_tts_service.settings") as mock_settings:
            mock_settings.qwen_api_key = "test_api_key"

            service = QwenTTSService()

            task_id = "test_task_123"

            with patch("urllib.request.urlopen") as mock_urlopen:
                mock_response = Mock()
                mock_response.read.return_value = bytes(
                    '{"output": {"task_status": "PENDING"}}',
                    "utf-8"
                )
                mock_urlopen.return_value.__enter__.return_value = mock_response

                with pytest.raises(Exception, match="TTS task timeout"):
                    service._wait_for_task_completion(task_id, max_retries=1, delay=0)

    @pytest.mark.asyncio
    async def test_get_tts_service_singleton(self):
        """测试 get_tts_service 单例模式"""
        from app.services.qwen_tts_service import get_tts_service, _tts_service

        # 确保全局变量为 None
        import app.services.qwen_tts_service as tts_module
        tts_module._tts_service = None

        with patch("app.services.qwen_tts_service.settings") as mock_settings:
            mock_settings.qwen_api_key = "test_api_key"

            # 第一次调用应该创建实例
            service1 = await get_tts_service()
            assert service1 is not None

            # 第二次调用应该返回相同的实例
            service2 = await get_tts_service()
            assert service2 is service1

    @pytest.mark.asyncio
    async def test_close_tts_service(self):
        """测试关闭 TTS 服务"""
        from app.services.qwen_tts_service import get_tts_service, close_tts_service, _tts_service

        import app.services.qwen_tts_service as tts_module

        with patch("app.services.qwen_tts_service.settings") as mock_settings:
            mock_settings.qwen_api_key = "test_api_key"

            # 获取服务
            service = await get_tts_service()
            assert tts_module._tts_service is not None

            # 关闭服务
            await close_tts_service()
            assert tts_module._tts_service is None