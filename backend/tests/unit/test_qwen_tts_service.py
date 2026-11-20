"""
Qwen TTS 服务单元测试
"""
import base64
import json
from unittest.mock import MagicMock, Mock, patch

import pytest

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

            mock_audio_data = b"fake_audio_data"

            with patch.object(service, "_synthesize_speech_sync") as mock_sync:
                mock_sync.return_value = mock_audio_data

                result = await service.synthesize_speech(
                    text="Hello, world!",
                    voice_id="xiaoyun",
                    instruction="clear narration",
                    speed=1.0,
                    volume=80,
                    pitch=1.0,
                    format="wav",
                    sample_rate=16000,
                )

                assert result == mock_audio_data
                mock_sync.assert_called_once_with(
                    "xiaoyun", "Hello, world!", "clear narration", 1.0, 80, 1.0, "wav", 16000, False, False, None
                )

    @pytest.mark.asyncio
    async def test_synthesize_speech_requires_voice_and_instruction(self):
        """当前 Qwen/CosyVoice 合成必须显式提供 voice_id 和 instruction。"""
        service = QwenTTSService(api_key="test_api_key", model="cosyvoice-v3")

        with pytest.raises(TypeError):
            await service.synthesize_speech(text="Test text")

    @pytest.mark.asyncio
    async def test_synthesize_speech_dispatches_to_sync_impl(self):
        """测试声音合成会派发到当前同步实现。"""
        service = QwenTTSService(api_key="test_api_key", model="cosyvoice-v3")

        with patch.object(service, "_synthesize_speech_sync") as mock_sync:
            mock_sync.return_value = "/tmp/cloned_audio.wav"

            result = await service.synthesize_speech(
                voice_id="cloned_voice_123",
                text="Hello from cloned voice!",
                instruction="clear narration",
                speed=1.2,
                volume=90,
                pitch=1.0,
                format="mp3",
                sample_rate=22050,
            )

            assert result == "/tmp/cloned_audio.wav"
            mock_sync.assert_called_once_with(
                "cloned_voice_123", "Hello from cloned voice!", "clear narration", 1.2, 90, 1.0, "mp3", 22050, False, False, None
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
                    test_audio_path, "Test Voice", None
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

                await service.register_cloned_voice(
                    reference_audio_path="/tmp/test.wav"
                )

                mock_sync.assert_called_once_with(
                    "/tmp/test.wav", "cloned_voice", None
                )

    def test_wait_for_task_completion_success(self):
        """测试等待任务完成成功"""
        with patch("app.services.qwen_tts_service.settings") as mock_settings:
            mock_settings.qwen_api_key = "test_api_key"

            service = QwenTTSService()

            task_id = "test_task_123"
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
        # 确保全局变量为 None
        import app.services.qwen_tts_service as tts_module
        from app.services.qwen_tts_service import get_tts_service
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
        import app.services.qwen_tts_service as tts_module
        from app.services.qwen_tts_service import close_tts_service, get_tts_service

        with patch("app.services.qwen_tts_service.settings") as mock_settings:
            mock_settings.qwen_api_key = "test_api_key"

            # 获取服务
            await get_tts_service()
            assert tts_module._tts_service is not None

            # 关闭服务
            await close_tts_service()
            assert tts_module._tts_service is None

    @pytest.mark.asyncio
    async def test_list_cloned_voices_success(self):
        """测试列出已克隆的声音成功"""
        with patch("app.services.qwen_tts_service.settings") as mock_settings:
            mock_settings.qwen_api_key = "test_api_key"

            service = QwenTTSService()

            expected_result = [
                {"voice_id": "voice_001", "name": "clone001", "status": "OK"},
                {"voice_id": "voice_002", "name": "clone002", "status": "OK"},
            ]

            with patch.object(service, "_list_cloned_voices_sync") as mock_sync:
                mock_sync.return_value = expected_result

                result = await service.list_cloned_voices()

                assert result == expected_result
                mock_sync.assert_called_once_with()

    def test_list_cloned_voices_sync_success(self):
        """测试同步列出已克隆的声音成功"""
        with patch("app.services.qwen_tts_service.settings") as mock_settings:
            mock_settings.qwen_api_key = "test_api_key"

            service = QwenTTSService()

            mock_response_data = {
                "code": "Success",
                "output": {
                    "voices": [
                        {"voice_id": "voice_001", "preferred_name": "clone001", "status": "OK"},
                        {"voice_id": "voice_002", "preferred_name": "clone002", "status": "OK"},
                    ]
                }
            }

            with patch("app.services.qwen_tts_service.VoiceEnrollmentService") as mock_cls:
                mock_service = Mock()
                mock_service.list_voices.return_value = mock_response_data["output"]["voices"]
                mock_cls.return_value = mock_service

                result = service._list_cloned_voices_sync()

                assert len(result) == 2
                assert result[0]["voice_id"] == "voice_001"
                assert result[1]["voice_id"] == "voice_002"

    def test_list_cloned_voices_sync_empty(self):
        """测试同步列出已克隆的声音为空"""
        with patch("app.services.qwen_tts_service.settings") as mock_settings:
            mock_settings.qwen_api_key = "test_api_key"

            service = QwenTTSService()

            with patch("app.services.qwen_tts_service.VoiceEnrollmentService") as mock_cls:
                mock_service = Mock()
                mock_service.list_voices.return_value = []
                mock_cls.return_value = mock_service

                result = service._list_cloned_voices_sync()

                assert result == []

    def test_list_cloned_voices_sync_no_voices_key(self):
        """测试同步列出已克隆的声音返回空（没有voices字段）"""
        with patch("app.services.qwen_tts_service.settings") as mock_settings:
            mock_settings.qwen_api_key = "test_api_key"

            service = QwenTTSService()

            with patch("app.services.qwen_tts_service.VoiceEnrollmentService") as mock_cls:
                mock_service = Mock()
                mock_service.list_voices.return_value = []
                mock_cls.return_value = mock_service

                result = service._list_cloned_voices_sync()

                assert result == []


class TestCosyVoiceBase64Enrollment:
    """CosyVoice base64 直传注册（voice-enrollment HTTP API）"""

    def _make_service(self) -> QwenTTSService:
        return QwenTTSService(api_key="test_api_key", model="cosyvoice-v3.5-plus")

    def _make_mp3(self, tmp_path, size_bytes=1024) -> str:
        path = tmp_path / "ref.mp3"
        path.write_bytes(b"\xff\xfb" + b"\x00" * (size_bytes - 2))
        return str(path)

    def _urlopen_response(self, payload: dict):
        resp = MagicMock()
        resp.read.return_value = json.dumps(payload).encode("utf-8")
        resp.__enter__.return_value = resp
        resp.__exit__.return_value = False
        return resp

    def test_build_audio_data_uri_mime_mapping(self, tmp_path):
        service = self._make_service()
        cases = {
            "a.mp3": "audio/mpeg",
            "b.wav": "audio/wav",
            "c.m4a": "audio/mp4",
        }
        for name, mime in cases.items():
            p = tmp_path / name
            p.write_bytes(b"0" * 64)
            uri = service._build_audio_data_uri(str(p))
            assert uri.startswith(f"data:{mime};base64,")
            base64.b64decode(uri.split(";base64,", 1)[1])  # 可解码

    def test_build_audio_data_uri_rejects_unsupported_ext(self, tmp_path):
        service = self._make_service()
        p = tmp_path / "x.flac"
        p.write_bytes(b"0" * 64)
        with pytest.raises(ValueError, match="Unsupported audio format"):
            service._build_audio_data_uri(str(p))

    def test_build_audio_data_uri_rejects_oversize(self, tmp_path):
        service = self._make_service()
        p = tmp_path / "big.mp3"
        p.write_bytes(b"0" * (10 * 1024 * 1024 + 1))
        with pytest.raises(ValueError, match="10MB"):
            service._build_audio_data_uri(str(p))

    def test_base64_enrollment_success(self, tmp_path):
        service = self._make_service()
        audio_path = self._make_mp3(tmp_path)

        captured_requests: list[dict] = []
        create_resp = self._urlopen_response(
            {"output": {"voice_id": "cosyvoice-v3.5-plus-clone-abc"}}
        )
        ok_resp = self._urlopen_response(
            {"output": {"voice_id": "cosyvoice-v3.5-plus-clone-abc", "status": "OK"}}
        )

        def fake_urlopen(req, context=None, **kwargs):
            body = json.loads(req.data.decode("utf-8"))
            captured_requests.append(body)
            return create_resp if body["input"]["action"] == "create_voice" else ok_resp

        with patch("app.services.qwen_tts_service.urllib.request.urlopen", side_effect=fake_urlopen), \
             patch.object(QwenTTSService, "_probe_audio_duration", return_value=12.0):
            result = service._register_cloned_voice_cosyvoice_base64(audio_path, "测试音色")

        assert result["voice_id"] == "cosyvoice-v3.5-plus-clone-abc"
        assert result["voice_name"] == "测试音色"
        assert result["role"] == "custom"
        assert result["target_model"] == "cosyvoice-v3.5-plus"
        assert result["enrollment_method"] == "base64"

        create_body = captured_requests[0]
        assert create_body["model"] == "voice-enrollment"
        assert create_body["input"]["action"] == "create_voice"
        assert create_body["input"]["target_model"] == "cosyvoice-v3.5-plus"
        prefix = create_body["input"]["prefix"]
        assert len(prefix) <= 10 and prefix.isalnum()
        assert create_body["input"]["audio"].startswith("data:audio/mpeg;base64,")

        query_body = captured_requests[1]
        assert query_body["input"]["action"] == "query_voice"
        assert query_body["input"]["voice_id"] == "cosyvoice-v3.5-plus-clone-abc"

    def test_base64_enrollment_undeployed_raises_with_voice_id(self, tmp_path):
        service = self._make_service()
        audio_path = self._make_mp3(tmp_path)

        responses = [
            self._urlopen_response({"output": {"voice_id": "voice-x"}}),
            self._urlopen_response({"output": {"voice_id": "voice-x", "status": "UNDEPLOYED"}}),
        ]

        with patch("app.services.qwen_tts_service.urllib.request.urlopen", side_effect=responses), \
             patch.object(QwenTTSService, "_probe_audio_duration", return_value=12.0):
            with pytest.raises(RuntimeError, match="voice-x"):
                service._register_cloned_voice_cosyvoice_base64(
                    audio_path, "n", max_attempts=1, poll_interval=0
                )

    def test_base64_enrollment_timeout_raises_with_voice_id(self, tmp_path):
        service = self._make_service()
        audio_path = self._make_mp3(tmp_path)

        responses = [self._urlopen_response({"output": {"voice_id": "voice-y"}})] + [
            self._urlopen_response({"output": {"voice_id": "voice-y", "status": "DEPLOYING"}})
        ] * 3

        with patch("app.services.qwen_tts_service.urllib.request.urlopen", side_effect=responses), \
             patch.object(QwenTTSService, "_probe_audio_duration", return_value=12.0):
            with pytest.raises(RuntimeError, match="voice-y"):
                service._register_cloned_voice_cosyvoice_base64(
                    audio_path, "n", max_attempts=3, poll_interval=0
                )

    def test_dispatch_local_file_routes_to_base64(self, tmp_path):
        service = self._make_service()
        with patch.object(service, "_register_cloned_voice_cosyvoice_base64") as mock_b64:
            service._register_cloned_voice_sync("/tmp/local.mp3", "n")
        mock_b64.assert_called_once_with("/tmp/local.mp3", "n", target_model=None)

    def test_dispatch_url_routes_to_sdk_path(self):
        service = self._make_service()
        with patch.object(service, "_register_cloned_voice_cosyvoice") as mock_sdk:
            service._register_cloned_voice_sync("https://cdn.example.com/a.wav", "n")
        mock_sdk.assert_called_once_with("https://cdn.example.com/a.wav", "n")


class TestGetTTSServiceBaseUrlConfig:
    """get_tts_service 读取界面配置的 base_url 并参与单例指纹"""

    @pytest.mark.asyncio
    async def test_base_url_from_ui_config_rebuilds_singleton(self):
        import app.services.qwen_tts_service as tts_module
        from app.services.qwen_tts_service import get_tts_service

        tts_module._tts_service = None
        tts_module._tts_config_fingerprint = None

        fake_db = object()
        config_by_key = {
            "qwen_tts": {
                "api_key": "k1",
                "model": "cosyvoice-v3.5-plus",
                "base_url": "https://ws.cn-beijing.maas.aliyuncs.com/api/v1",
            },
            "app": {},
        }

        with patch("app.services.qwen_tts_service.settings") as mock_settings, \
             patch("app.core.model_config_service.get_effective_config",
                   side_effect=lambda db, key: config_by_key.get(key, {})):
            mock_settings.qwen_api_key = ""
            mock_settings.qwen_model = ""
            mock_settings.public_base_url = ""
            mock_settings.qwen_base_url = "https://dashscope.aliyuncs.com/api/v1"

            svc = await get_tts_service(fake_db)
            assert svc.base_url == "https://ws.cn-beijing.maas.aliyuncs.com/api/v1"

            config_by_key["qwen_tts"] = {
                **config_by_key["qwen_tts"],
                "base_url": "https://dashscope.aliyuncs.com/api/v1",
            }
            svc2 = await get_tts_service(fake_db)
            assert svc2 is not svc
            assert svc2.base_url == "https://dashscope.aliyuncs.com/api/v1"

        tts_module._tts_service = None
        tts_module._tts_config_fingerprint = None


class TestListClonedVoicesPagination:
    """list_cloned_voices 分页拉取全部云端音色（不限于单页 10 条）"""

    def test_paginates_until_short_page(self):
        service = QwenTTSService(api_key="test_api_key", model="cosyvoice-v3.5-plus")

        page1 = [{"voice_id": f"v1-{i}", "status": "OK"} for i in range(50)]
        page2 = [{"voice_id": f"v2-{i}", "status": "OK"} for i in range(20)]
        calls: list[tuple] = []

        def fake_list(prefix, page_index=0, page_size=10):
            calls.append((prefix, page_index, page_size))
            return page1 if page_index == 0 else page2

        with patch("app.services.qwen_tts_service.settings") as ms, \
             patch("app.services.qwen_tts_service.VoiceEnrollmentService") as mock_cls:
            ms.qwen_api_key = "test_api_key"
            ms.qwen_model = "cosyvoice-v3.5-plus"
            inst = Mock()
            inst.list_voices.side_effect = fake_list
            mock_cls.return_value = inst

            result = service._list_cloned_voices_sync()

        assert len(result) == 70
        assert calls[0] == ("", 0, 50)
        assert calls[1] == ("", 1, 50)

    def test_stops_at_quota_cap(self):
        """配额上限 1000：每页都满时不得无限翻页。"""
        service = QwenTTSService(api_key="test_api_key", model="cosyvoice-v3.5-plus")

        full_page = [{"voice_id": f"v{i}", "status": "OK"} for i in range(50)]

        with patch("app.services.qwen_tts_service.settings") as ms, \
             patch("app.services.qwen_tts_service.VoiceEnrollmentService") as mock_cls:
            ms.qwen_api_key = "test_api_key"
            ms.qwen_model = "cosyvoice-v3.5-plus"
            inst = Mock()
            inst.list_voices.return_value = full_page
            mock_cls.return_value = inst

            result = service._list_cloned_voices_sync()

        assert len(result) == 1000
        assert inst.list_voices.call_count == 20


class TestDeriveVoiceDisplayName:
    """从 Qwen voice_id 派生可读显示名（新 API list 响应无 name 字段）"""

    def test_strips_target_model_and_hash(self):
        from app.services.qwen_tts_service import derive_voice_display_name

        voice_id = "cosyvoice-v3.5-plus-guanyu-" + "a" * 32
        assert derive_voice_display_name(voice_id, "cosyvoice-v3.5-plus") == "guanyu"

    def test_bailian_prefix(self):
        from app.services.qwen_tts_service import derive_voice_display_name

        voice_id = "cosyvoice-v3.5-plus-bailian-24dfc9059ecd4f0b907fcb5d5efe2852"
        assert derive_voice_display_name(voice_id, "cosyvoice-v3.5-plus") == "bailian"

    def test_strips_hash_without_target_model(self):
        from app.services.qwen_tts_service import derive_voice_display_name

        voice_id = "cosyvoice-v3.5-plus-guanyu-" + "0123abcd" * 4
        assert derive_voice_display_name(voice_id) == "cosyvoice-v3.5-plus-guanyu"

    def test_fallback_keeps_id_when_no_hash_tail(self):
        from app.services.qwen_tts_service import derive_voice_display_name

        assert (
            derive_voice_display_name("cosyvoice-v3.5-plus-guanyu", "cosyvoice-v3.5-plus")
            == "guanyu"
        )
        assert derive_voice_display_name("some-weird-id") == "some-weird-id"


class TestTargetModelSelection:
    """目标 TTS 模型可选：注册时显式指定、合成按音色绑定覆盖"""

    def test_base64_enrollment_uses_explicit_target_model(self, tmp_path):
        service = QwenTTSService(api_key="test_api_key", model="cosyvoice-v3.5-plus")
        path = tmp_path / "ref.mp3"
        path.write_bytes(b"\xff\xfb" + b"\x00" * 128)

        captured: list[dict] = []

        def fake_urlopen(req, context=None, **kwargs):
            body = json.loads(req.data.decode("utf-8"))
            captured.append(body)
            if body["input"]["action"] == "create_voice":
                resp = MagicMock()
                resp.read.return_value = json.dumps({"output": {"voice_id": "v-flash"}}).encode()
                resp.__enter__.return_value = resp
                resp.__exit__.return_value = False
                return resp
            resp = MagicMock()
            resp.read.return_value = json.dumps({"output": {"voice_id": "v-flash", "status": "OK"}}).encode()
            resp.__enter__.return_value = resp
            resp.__exit__.return_value = False
            return resp

        with patch("app.services.qwen_tts_service.urllib.request.urlopen", side_effect=fake_urlopen), \
             patch.object(QwenTTSService, "_probe_audio_duration", return_value=12.0):
            result = service._register_cloned_voice_cosyvoice_base64(
                str(path), "n", target_model="cosyvoice-v3.5-flash"
            )

        assert captured[0]["input"]["target_model"] == "cosyvoice-v3.5-flash"
        assert result["target_model"] == "cosyvoice-v3.5-flash"

    def test_base64_enrollment_defaults_to_configured_model(self, tmp_path):
        service = QwenTTSService(api_key="test_api_key", model="cosyvoice-v3.5-plus")
        path = tmp_path / "ref.mp3"
        path.write_bytes(b"\xff\xfb" + b"\x00" * 128)

        captured: list[dict] = []

        def fake_urlopen(req, context=None, **kwargs):
            body = json.loads(req.data.decode("utf-8"))
            captured.append(body)
            resp = MagicMock()
            payload = (
                {"output": {"voice_id": "v2"}}
                if body["input"]["action"] == "create_voice"
                else {"output": {"voice_id": "v2", "status": "OK"}}
            )
            resp.read.return_value = json.dumps(payload).encode()
            resp.__enter__.return_value = resp
            resp.__exit__.return_value = False
            return resp

        with patch("app.services.qwen_tts_service.urllib.request.urlopen", side_effect=fake_urlopen), \
             patch.object(QwenTTSService, "_probe_audio_duration", return_value=12.0):
            result = service._register_cloned_voice_cosyvoice_base64(str(path), "n")

        assert captured[0]["input"]["target_model"] == "cosyvoice-v3.5-plus"
        assert result["target_model"] == "cosyvoice-v3.5-plus"

    @pytest.mark.asyncio
    async def test_synthesize_speech_passes_model_override(self):
        service = QwenTTSService(api_key="test_api_key", model="cosyvoice-v3.5-plus")

        with patch.object(service, "_synthesize_speech_sync") as mock_sync:
            mock_sync.return_value = "/tmp/out.wav"
            await service.synthesize_speech(
                voice_id="v1",
                text="hi",
                instruction="clear",
                model_override="cosyvoice-v3.5-flash",
            )

        assert mock_sync.call_args.args[-1] == "cosyvoice-v3.5-flash"

    def test_synthesize_voice_cosyvoice_uses_override_model(self, tmp_path, monkeypatch):
        """合成调用必须使用 model_override（音色绑定的 target_model）。"""
        service = QwenTTSService(api_key="test_api_key", model="cosyvoice-v3.5-plus")

        captured: dict = {}

        class FakeResult:
            audio_url = None

        def fake_call(**kwargs):
            captured.update(kwargs)
            return FakeResult()

        monkeypatch.setattr(
            "dashscope.audio.http_tts.http_speech_synthesizer.HttpSpeechSynthesizer.call",
            staticmethod(fake_call),
        )
        monkeypatch.setattr(service, "_probe_audio_duration", lambda *_: None, raising=False)

        with pytest.raises(Exception):
            # audio_url 缺失会抛错，但我们只关心 call 的参数
            service._synthesize_voice_cosyvoice(
                "v1", "text", "instr", model_override="cosyvoice-v3.5-flash"
            )

        assert captured.get("model") == "cosyvoice-v3.5-flash"
