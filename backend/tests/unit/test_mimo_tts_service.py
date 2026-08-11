"""MiMoTTSService 单元测试（httpx 化）

2A 目标：`_call_api_sync` 从 urllib 换成 httpx（同步 `httpx.Client`），
请求头 / payload / 超时 / 错误处理 / 返回结构完全不变。
测试用 `httpx.MockTransport` 注入，不碰全局、不发真实网络请求。
"""
import base64
import json

import httpx
import pytest

from app.services.mimo_tts_service import MiMoTTSService

FAKE_AUDIO = b"\x52\x49\x46\x46fake-wav-bytes"


def _ok_response(audio: bytes = FAKE_AUDIO) -> httpx.Response:
    return httpx.Response(
        200,
        json={
            "choices": [
                {"message": {"audio": {"data": base64.b64encode(audio).decode()}}}
            ]
        },
    )


def _service(handler, base_url="https://api.xiaomimimo.com/v1") -> MiMoTTSService:
    transport = httpx.MockTransport(handler)
    return MiMoTTSService(api_key="sk-test-key", base_url=base_url, transport=transport)


class TestCallApiSync:
    def test_success_request_shape_and_response(self):
        """成功路径：URL/方法/请求头/payload 与原 urllib 实现一致，返回解码后的音频字节。"""
        seen = {}

        def handler(request: httpx.Request) -> httpx.Response:
            seen["url"] = str(request.url)
            seen["method"] = request.method
            seen["api_key"] = request.headers.get("api-key")
            seen["content_type"] = request.headers.get("content-type")
            seen["payload"] = json.loads(request.content.decode("utf-8"))
            return _ok_response()

        service = _service(handler, base_url="https://example.test/v1/")
        messages = [{"role": "user", "content": "你好"}]
        audio_params = {"format": "wav", "voice": "冰糖"}

        result = service._call_api_sync("mimo-v2.5-tts", messages, audio_params)

        assert result == FAKE_AUDIO
        # base_url 尾部斜杠被剥掉
        assert seen["url"] == "https://example.test/v1/chat/completions"
        assert seen["method"] == "POST"
        assert seen["api_key"] == "sk-test-key"
        assert seen["content_type"] == "application/json"
        assert seen["payload"] == {
            "model": "mimo-v2.5-tts",
            "messages": messages,
            "audio": audio_params,
        }

    def test_http_error_raises_runtime_error_with_body(self):
        """HTTP 错误：RuntimeError 消息含状态码和响应体（对齐原 urllib HTTPError 分支）。"""

        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(429, text='{"error": "rate limited"}')

        service = _service(handler)
        with pytest.raises(RuntimeError, match=r"MiMo TTS API error 429: .*rate limited"):
            service._call_api_sync("mimo-v2.5-tts", [], {})

    def test_transport_error_raises_runtime_error(self):
        """连接失败：RuntimeError 消息含 connection error（对齐原 urllib URLError 分支）。"""

        def handler(request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError("connection refused", request=request)

        service = _service(handler)
        with pytest.raises(RuntimeError, match="MiMo TTS API connection error"):
            service._call_api_sync("mimo-v2.5-tts", [], {})

    def test_invalid_json_raises_runtime_error(self):
        """响应不是合法 JSON：RuntimeError('MiMo TTS API returned invalid JSON')。"""

        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, text="<html>not json</html>")

        service = _service(handler)
        with pytest.raises(RuntimeError, match="MiMo TTS API returned invalid JSON"):
            service._call_api_sync("mimo-v2.5-tts", [], {})

    def test_no_choices_raises(self):
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json={"choices": []})

        service = _service(handler)
        with pytest.raises(RuntimeError, match="no choices"):
            service._call_api_sync("mimo-v2.5-tts", [], {})

    def test_no_audio_data_raises(self):
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json={"choices": [{"message": {"audio": {}}}]})

        service = _service(handler)
        with pytest.raises(RuntimeError, match="no audio data"):
            service._call_api_sync("mimo-v2.5-tts", [], {})


class TestAsyncEntrypoints:
    @pytest.mark.asyncio
    async def test_synthesize_preset_roundtrip(self):
        """异步公开入口经 run_in_executor 走同一条 httpx 同步路径。"""
        seen = {}

        def handler(request: httpx.Request) -> httpx.Response:
            seen["payload"] = json.loads(request.content.decode("utf-8"))
            return _ok_response()

        service = _service(handler)
        result = await service.synthesize_preset(
            text="要合成的文本", voice="Mia", instruction="欢快地说", format="mp3"
        )

        assert result == FAKE_AUDIO
        payload = seen["payload"]
        assert payload["model"] == "mimo-v2.5-tts"
        assert payload["messages"] == [
            {"role": "user", "content": "欢快地说"},
            {"role": "assistant", "content": "要合成的文本"},
        ]
        assert payload["audio"] == {"format": "mp3", "voice": "Mia"}

    @pytest.mark.asyncio
    async def test_synthesize_voice_clone_roundtrip(self):
        seen = {}

        def handler(request: httpx.Request) -> httpx.Response:
            seen["payload"] = json.loads(request.content.decode("utf-8"))
            return _ok_response()

        service = _service(handler)
        result = await service.synthesize_voice_clone(
            text="克隆合成", audio_base64="QUJD", mime_type="audio/wav"
        )

        assert result == FAKE_AUDIO
        payload = seen["payload"]
        assert payload["model"] == "mimo-v2.5-tts-voiceclone"
        assert payload["audio"]["voice"] == "data:audio/wav;base64,QUJD"
