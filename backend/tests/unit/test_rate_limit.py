"""Try 页匿名合成限流（单 IP 每日 50 次 edge_tts）单元测试。

详见 docs/superpowers/specs/2026-08-20-try-page-seo-acquisition-design.md。
"""
from unittest.mock import Mock

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from app.core import rate_limit
from app.core.config import settings


def _request(headers: list[tuple[bytes, bytes]] | None = None, client: tuple[str, int] | None = ("9.9.9.9", 1234)) -> Request:
    return Request({"type": "http", "headers": headers or [], "client": client})


class TestGetClientIp:
    def test_prefers_cf_connecting_ip(self):
        req = _request([
            (b"cf-connecting-ip", b"1.1.1.1"),
            (b"x-forwarded-for", b"2.2.2.2, 3.3.3.3"),
        ])
        assert rate_limit.get_client_ip(req) == "1.1.1.1"

    def test_falls_back_to_x_forwarded_for_first_entry(self):
        req = _request([(b"x-forwarded-for", b"2.2.2.2, 3.3.3.3")])
        assert rate_limit.get_client_ip(req) == "2.2.2.2"

    def test_falls_back_to_client_host(self):
        assert rate_limit.get_client_ip(_request()) == "9.9.9.9"

    def test_no_client_returns_unknown(self):
        assert rate_limit.get_client_ip(_request(client=None)) == "unknown"


class TestInMemoryRateLimitStore:
    def test_hit_increments_per_key_and_day(self):
        store = rate_limit.InMemoryRateLimitStore()
        assert store.hit("ip:1.1.1.1", "2026-08-20") == 1
        assert store.hit("ip:1.1.1.1", "2026-08-20") == 2
        # 不同 key / 不同 day 互不影响
        assert store.hit("ip:2.2.2.2", "2026-08-20") == 1
        assert store.hit("ip:1.1.1.1", "2026-08-21") == 1


class TestEnforceTryRateLimit:
    def _anon_request(self) -> Request:
        req = _request()
        req.state.user = None
        req.state.legacy_admin = False
        return req

    def test_allows_requests_under_limit(self, monkeypatch):
        monkeypatch.setattr(settings, "deploy_target", "workers")
        monkeypatch.setattr(settings, "try_anon_daily_limit", 2)
        store = rate_limit.InMemoryRateLimitStore()
        monkeypatch.setattr(rate_limit, "get_rate_limit_store", lambda: store)

        rate_limit.enforce_try_rate_limit(self._anon_request())  # 1
        rate_limit.enforce_try_rate_limit(self._anon_request())  # 2，不抛

    def test_raises_429_over_limit(self, monkeypatch):
        monkeypatch.setattr(settings, "deploy_target", "workers")
        monkeypatch.setattr(settings, "try_anon_daily_limit", 1)
        store = rate_limit.InMemoryRateLimitStore()
        monkeypatch.setattr(rate_limit, "get_rate_limit_store", lambda: store)

        rate_limit.enforce_try_rate_limit(self._anon_request())
        with pytest.raises(HTTPException) as exc:
            rate_limit.enforce_try_rate_limit(self._anon_request())
        assert exc.value.status_code == 429
        assert exc.value.detail["code"] == "rate_limit_exceeded"

    def test_authenticated_user_not_limited(self, monkeypatch):
        monkeypatch.setattr(settings, "deploy_target", "workers")
        monkeypatch.setattr(settings, "try_anon_daily_limit", 0)
        store = Mock(spec=rate_limit.InMemoryRateLimitStore)
        monkeypatch.setattr(rate_limit, "get_rate_limit_store", lambda: store)

        req = self._anon_request()
        req.state.user = {"id": "u1", "email": "a@b.c"}
        rate_limit.enforce_try_rate_limit(req)  # 不抛，且不计数
        store.hit.assert_not_called()

    def test_local_mode_not_limited(self, monkeypatch):
        monkeypatch.setattr(settings, "deploy_target", "local")
        monkeypatch.setattr(settings, "try_anon_daily_limit", 0)
        store = Mock(spec=rate_limit.InMemoryRateLimitStore)
        monkeypatch.setattr(rate_limit, "get_rate_limit_store", lambda: store)

        rate_limit.enforce_try_rate_limit(self._anon_request())
        store.hit.assert_not_called()

    def test_store_failure_fails_open(self, monkeypatch):
        """限流存储故障不阻断功能（best-effort，与 stats 中间件同策略）。"""
        monkeypatch.setattr(settings, "deploy_target", "workers")
        monkeypatch.setattr(settings, "try_anon_daily_limit", 1)
        store = Mock(spec=rate_limit.InMemoryRateLimitStore)
        store.hit.side_effect = RuntimeError("supabase down")
        monkeypatch.setattr(rate_limit, "get_rate_limit_store", lambda: store)

        rate_limit.enforce_try_rate_limit(self._anon_request())  # 不抛
