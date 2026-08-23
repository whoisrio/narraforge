"""Unit tests for app.services.indextts_service (IndexTTS sidecar HTTP 客户端)。

用 httpx.MockTransport 注入打桩，不访问真实 sidecar。
"""
import httpx
import pytest

from app.services.indextts_service import IndexTTSService, IndexTTSServiceError


def _service(handler) -> IndexTTSService:
    return IndexTTSService(
        base_url="http://test-sidecar",
        timeout=5,
        transport=httpx.MockTransport(handler),
    )


@pytest.mark.asyncio
async def test_status_returns_json():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/status"
        return httpx.Response(200, json={"loaded": True, "device": "cuda", "vram_used_mb": 4096})

    svc = _service(handler)
    data = await svc.status()
    assert data["loaded"] is True
    assert data["device"] == "cuda"


@pytest.mark.asyncio
async def test_load_unload_return_json():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/load":
            return httpx.Response(200, json={"success": True, "load_time_sec": 12.3})
        assert request.url.path == "/unload"
        return httpx.Response(200, json={"success": True, "vram_used_mb": 0})

    svc = _service(handler)
    assert (await svc.load())["success"] is True
    assert (await svc.unload())["vram_used_mb"] == 0


@pytest.mark.asyncio
async def test_synthesize_returns_wav_bytes_and_sends_body():
    wav = b"RIFF\x00\x00\x00\x00WAVEfmt "
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        import json as _json
        assert request.url.path == "/synthesize"
        captured.update(_json.loads(request.content))
        return httpx.Response(200, content=wav, headers={"Content-Type": "audio/wav"})

    svc = _service(handler)
    out = await svc.synthesize(
        text="你好",
        lang="ZH",
        prompt_wav_path="/tmp/ref.wav",
        emo_vector=[1, 0, 0, 0, 0, 0, 0, 0],
        emo_alpha=0.8,
        duration_factor=1.2,
    )
    assert out == wav
    assert captured["text"] == "你好"
    assert captured["lang"] == "ZH"
    assert captured["prompt_wav_path"] == "/tmp/ref.wav"
    assert captured["emo_vector"] == [1, 0, 0, 0, 0, 0, 0, 0]
    assert captured["emo_alpha"] == 0.8
    assert captured["duration_factor"] == 1.2


@pytest.mark.asyncio
async def test_connect_error_raises_chinese_hint():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused", request=request)

    svc = _service(handler)
    with pytest.raises(IndexTTSServiceError, match="IndexTTS sidecar 未启动，请先运行 sidecar 服务"):
        await svc.status()


@pytest.mark.asyncio
async def test_http_error_propagates_detail():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, json={"detail": "emo_vector 维度必须为 8"})

    svc = _service(handler)
    with pytest.raises(IndexTTSServiceError, match="emo_vector 维度必须为 8"):
        await svc.synthesize(text="你好", lang="ZH", prompt_wav_path="/tmp/ref.wav")


@pytest.mark.asyncio
async def test_http_error_non_json_falls_back_to_text():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(502, text="bad gateway")

    svc = _service(handler)
    with pytest.raises(IndexTTSServiceError, match="bad gateway"):
        await svc.load()
