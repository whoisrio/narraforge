"""EdgeTTSService 部署策略分发测试（local=edge-tts 包 / workers=内置 WS 客户端）

workers 模式：synthesize 走 edge_tts_ws_client（不碰 edge_tts 包），
list_voices 走 httpx REST（voices/list 端点，MockTransport 注入）。
local 模式行为由 test_edge_tts_service.py 既有测试锁定，此处不重复。
"""
import os
import subprocess
import sys
from pathlib import Path
from unittest.mock import AsyncMock

import httpx
import pytest

import app.services.edge_tts_service as edge_module
from app.core.config import settings
from app.services.edge_tts_service import EdgeTTSService

FAKE_MP3 = b"\xff\xfb\x90\x00" * 50


@pytest.fixture
def workers_mode(monkeypatch):
    monkeypatch.setattr(settings, "deploy_target", "workers")
    yield


@pytest.mark.asyncio
async def test_workers_synthesize_delegates_to_ws_client(workers_mode, monkeypatch):
    mock_ws = AsyncMock(return_value=FAKE_MP3)
    monkeypatch.setattr("app.services.edge_tts_ws_client.synthesize", mock_ws)

    service = EdgeTTSService()
    audio, fmt = await service.synthesize(
        text="你好", voice="zh-CN-XiaoxiaoNeural", rate="+10%", volume="-5%"
    )

    assert audio == FAKE_MP3
    assert fmt == "mp3"
    mock_ws.assert_awaited_once_with(
        text="你好", voice="zh-CN-XiaoxiaoNeural", rate="+10%", volume="-5%"
    )


@pytest.mark.asyncio
async def test_workers_synthesize_does_not_touch_edge_tts_package(workers_mode, monkeypatch):
    """workers 路径即使 edge_tts 包不可用也必须成功（策略分发在选择之后才 import）。"""
    monkeypatch.setattr("app.services.edge_tts_ws_client.synthesize", AsyncMock(return_value=FAKE_MP3))
    # 模拟 edge_tts 包缺失：任何 Communicate 调用都会炸
    monkeypatch.setattr(edge_module, "edge_tts", None, raising=False)

    service = EdgeTTSService()
    audio, _ = await service.synthesize(text="hi", voice="zh-CN-XiaoxiaoNeural")
    assert audio == FAKE_MP3


@pytest.mark.asyncio
async def test_workers_synthesize_retries_on_failure(workers_mode, monkeypatch):
    """与 local 路径一致的重试语义：最后一次失败才抛。"""
    mock_ws = AsyncMock(side_effect=[RuntimeError("boom"), FAKE_MP3])
    monkeypatch.setattr("app.services.edge_tts_ws_client.synthesize", mock_ws)
    monkeypatch.setattr("asyncio.sleep", AsyncMock())

    service = EdgeTTSService()
    audio, fmt = await service.synthesize(text="hi", voice="v", max_retries=2)
    assert audio == FAKE_MP3
    assert mock_ws.await_count == 2


_RAW_VOICES = [
    {
        "Name": "Microsoft Server Speech Text to Speech Voice (zh-CN, XiaoxiaoNeural)",
        "ShortName": "zh-CN-XiaoxiaoNeural",
        "Gender": "Female",
        "Locale": "zh-CN",
        "FriendlyName": "Xiaoxiao",
        "Status": "GA",
        "VoiceTag": {"ContentCategories": ["General"], "VoicePersonalities": []},
    },
    {
        "Name": "Microsoft Server Speech Text to Speech Voice (en-US, GuyNeural)",
        "ShortName": "en-US-GuyNeural",
        "Gender": "Male",
        "Locale": "en-US",
        "FriendlyName": "Guy",
        "Status": "GA",
        "VoiceTag": {"ContentCategories": ["General"], "VoicePersonalities": []},
    },
]


@pytest.mark.asyncio
async def test_workers_list_voices_via_httpx(workers_mode):
    """workers 模式音色列表走 voices/list REST 端点（httpx + Sec-MS-GEC）。"""
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        return httpx.Response(200, json=_RAW_VOICES)

    service = EdgeTTSService(voices_transport=httpx.MockTransport(handler))
    service._voices_cache = None

    voices = await service.list_voices()

    assert "voices/list" in seen["url"]
    assert "trustedclienttoken=" in seen["url"]
    assert "Sec-MS-GEC=" in seen["url"]
    assert [v["short_name"] for v in voices] == ["zh-CN-XiaoxiaoNeural", "en-US-GuyNeural"]
    assert voices[0]["language"] == "Chinese"
    assert voices[0]["display_name"] == "Xiaoxiao"


@pytest.mark.asyncio
async def test_workers_list_voices_filter(workers_mode):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=_RAW_VOICES)

    service = EdgeTTSService(voices_transport=httpx.MockTransport(handler))
    service._voices_cache = None

    voices = await service.list_voices(language="Chinese")
    assert len(voices) == 1
    assert voices[0]["short_name"] == "zh-CN-XiaoxiaoNeural"


def test_module_import_in_workers_mode_does_not_import_edge_tts():
    """DEPLOY_TARGET=workers 的干净子进程里 import 本模块不得加载 edge_tts 包。"""
    script = (
        "import sys; import app.services.edge_tts_service; "
        "assert 'edge_tts' not in sys.modules, 'edge_tts leaked'"
    )
    env = {**os.environ, "DEPLOY_TARGET": "workers"}
    backend_dir = Path(edge_module.__file__).parent.parent.parent
    result = subprocess.run(
        [sys.executable, "-c", script],
        cwd=backend_dir,
        env=env,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
