"""6A-1：workers 模式下 edge-tts 合成策略按运行时能力回退。

DEPLOY_TARGET=workers 有两个真实运行时：
- 真 Cloudflare Workers（Pyodide）：有 workers.fetch → 内置 WS 客户端。
- Render 等 CPython 部署（同一组在线路由，但 CPython 正常运行时）：
  无 workers 模块 → 回退 edge-tts 包（local-services extra 已装）。
两者皆无（未装 edge-tts 的 Pyodide 之外环境）→ 响亮 RuntimeError。
"""
import sys
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

import app.services.edge_tts_service as edge_module
from app.core.config import settings
from app.services.edge_tts_service import EdgeTTSService

FAKE_MP3 = b"\xff\xfb\x90\x00" * 50


@pytest.fixture
def workers_mode(monkeypatch):
    monkeypatch.setattr(settings, "deploy_target", "workers")
    yield


class TestWorkersRuntimeAvailable:
    def test_false_without_workers_module(self, monkeypatch):
        # sys.modules["workers"] = None → import workers 抛 ImportError
        monkeypatch.setitem(sys.modules, "workers", None)
        assert edge_module._workers_runtime_available() is False

    def test_true_when_workers_fetch_present(self, monkeypatch):
        monkeypatch.setitem(sys.modules, "workers", SimpleNamespace(fetch=object()))
        assert edge_module._workers_runtime_available() is True

    def test_false_when_fetch_attr_missing(self, monkeypatch):
        monkeypatch.setitem(sys.modules, "workers", SimpleNamespace())
        assert edge_module._workers_runtime_available() is False


class TestEdgeTtsPackageAvailable:
    def test_true_in_local_mode(self, monkeypatch):
        monkeypatch.setattr(settings, "deploy_target", "local")
        # local 模式模块级 import 已成功（否则模块根本加载不进来）
        assert edge_module._edge_tts_package_available() is True

    def test_workers_mode_true_when_installed(self, workers_mode):
        # 测试 venv 装有 edge-tts（local-services extra）
        assert edge_module._edge_tts_package_available() is True

    def test_workers_mode_false_when_missing(self, workers_mode, monkeypatch):
        monkeypatch.setitem(sys.modules, "edge_tts", None)
        assert edge_module._edge_tts_package_available() is False


class TestSynthesizeFallback:
    @pytest.mark.asyncio
    async def test_workers_mode_falls_back_to_edge_tts_package(self, workers_mode, monkeypatch):
        """Render 场景：workers 模式 + 无 workers 运行时 → 走 edge-tts 包。"""
        monkeypatch.setattr(edge_module, "_workers_runtime_available", lambda: False)
        mock_ws = AsyncMock()
        monkeypatch.setattr("app.services.edge_tts_ws_client.synthesize", mock_ws)
        captured = {}

        class _FakeCommunicate:
            def __init__(self, **kwargs):
                captured.update(kwargs)

            async def stream(self):
                yield {"type": "audio", "data": FAKE_MP3}

        monkeypatch.setattr("edge_tts.Communicate", _FakeCommunicate)

        service = EdgeTTSService()
        audio, fmt = await service.synthesize(
            text="你好", voice="zh-CN-XiaoxiaoNeural", rate="+5%", volume="-10%"
        )

        assert audio == FAKE_MP3
        assert fmt == "mp3"
        mock_ws.assert_not_called()
        assert captured["text"] == "你好"
        assert captured["voice"] == "zh-CN-XiaoxiaoNeural"
        assert captured["rate"] == "+5%"
        assert captured["volume"] == "-10%"

    @pytest.mark.asyncio
    async def test_workers_mode_prefers_ws_client_when_runtime_available(
        self, workers_mode, monkeypatch
    ):
        """真 Pyodide Workers：workers.fetch 可用 → 仍走内置 WS 客户端。"""
        monkeypatch.setattr(edge_module, "_workers_runtime_available", lambda: True)
        mock_ws = AsyncMock(return_value=FAKE_MP3)
        monkeypatch.setattr("app.services.edge_tts_ws_client.synthesize", mock_ws)

        service = EdgeTTSService()
        audio, fmt = await service.synthesize(text="hi", voice="zh-CN-XiaoxiaoNeural")

        assert audio == FAKE_MP3
        assert fmt == "mp3"
        mock_ws.assert_awaited_once_with(
            text="hi", voice="zh-CN-XiaoxiaoNeural", rate="+0%", volume="+0%"
        )

    @pytest.mark.asyncio
    async def test_workers_mode_no_runtime_no_package_is_loud(self, workers_mode, monkeypatch):
        """既无 workers 运行时也无 edge-tts 包 → 响亮错误（配置/部署问题，不静默）。"""
        monkeypatch.setattr(edge_module, "_workers_runtime_available", lambda: False)
        monkeypatch.setattr(edge_module, "_edge_tts_package_available", lambda: False)

        service = EdgeTTSService()
        with pytest.raises(RuntimeError, match="edge-tts"):
            await service.synthesize(text="hi", voice="v")
