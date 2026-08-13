"""V3（Vercel 适配）：出站调用超时按部署目标收敛。

Vercel Hobby（fluid compute，2026-08 官方文档核实）函数时长上限 300s；
workers 模式把出站超时 Cap 到 250s（留 50s 平台余量），local 模式保持
settings 原值（默认 120s，本地行为零回退）。
"""
import base64

import pytest

from app.core.config import (
    WORKERS_UPSTREAM_TIMEOUT_CAP,
    get_upstream_timeout,
    settings,
)
from app.services.mimo_tts_service import MiMoTTSService


@pytest.fixture
def restore_timeout_settings(monkeypatch):
    """用例间隔离：显式设置 deploy_target / upstream_timeout_seconds。"""
    monkeypatch.setattr(settings, "deploy_target", "local")
    monkeypatch.setattr(settings, "upstream_timeout_seconds", 120.0)
    return monkeypatch


class TestGetUpstreamTimeout:
    def test_local_default_unchanged(self, restore_timeout_settings):
        assert get_upstream_timeout() == 120.0

    def test_local_not_capped(self, restore_timeout_settings):
        restore_timeout_settings.setattr(settings, "upstream_timeout_seconds", 400.0)
        assert get_upstream_timeout() == 400.0

    def test_workers_capped_to_platform_limit(self, restore_timeout_settings):
        restore_timeout_settings.setattr(settings, "deploy_target", "workers")
        restore_timeout_settings.setattr(settings, "upstream_timeout_seconds", 400.0)
        assert get_upstream_timeout() == WORKERS_UPSTREAM_TIMEOUT_CAP == 250.0

    def test_workers_below_cap_kept(self, restore_timeout_settings):
        restore_timeout_settings.setattr(settings, "deploy_target", "workers")
        assert get_upstream_timeout() == 120.0


class TestMimoServiceTimeout:
    def test_mimo_call_uses_effective_timeout(self, restore_timeout_settings):
        """mimo 出站调用必须使用收敛后的有效超时（而非硬编码 120）。"""
        restore_timeout_settings.setattr(settings, "deploy_target", "workers")
        restore_timeout_settings.setattr(settings, "upstream_timeout_seconds", 400.0)

        captured: dict = {}

        class _FakeResponse:
            def raise_for_status(self):
                return None

            def json(self):
                audio_b64 = base64.b64encode(b"audio").decode()
                return {"choices": [{"message": {"audio": {"data": audio_b64}}}]}

        class _FakeClient:
            def __init__(self, **kwargs):
                captured.update(kwargs)

            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

            def post(self, *args, **kwargs):
                return _FakeResponse()

        restore_timeout_settings.setattr(
            "app.services.mimo_tts_service.httpx.Client", _FakeClient
        )

        service = MiMoTTSService(api_key="k", base_url="https://example.com/v1")
        audio = service._call_api_sync("mimo-v2.5-tts", [{"role": "user", "content": ""}], {"format": "wav"})

        assert audio == b"audio"
        assert captured["timeout"] == WORKERS_UPSTREAM_TIMEOUT_CAP
