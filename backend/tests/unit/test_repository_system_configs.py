"""步骤 3A：SystemConfig 仓储（Protocol + Local + Supabase）。

方法签名从 system_config_service / model_config_service 的实际调用提取：
只有 get(key, default) / set(key, value) 两个原语（YAGNI）。
"""
import json

import httpx

from app.core.repositories.system_configs import (
    LocalSystemConfigRepository,
    SupabaseSystemConfigRepository,
    SystemConfigRepository,
)


def _supabase(handler) -> tuple[SupabaseSystemConfigRepository, list[httpx.Request]]:
    from app.core.supabase_client import SupabaseClient

    requests: list[httpx.Request] = []

    def _handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return handler(request)

    client = SupabaseClient("https://test.supabase.co", "k", transport=httpx.MockTransport(_handler))
    return SupabaseSystemConfigRepository(client), requests


class TestProtocolConformance:
    def test_local_implements_protocol(self, db_session):
        assert isinstance(LocalSystemConfigRepository(db_session), SystemConfigRepository)

    def test_supabase_implements_protocol(self):
        repo, _ = _supabase(lambda req: httpx.Response(200, json=[]))
        assert isinstance(repo, SystemConfigRepository)


class TestSupabaseSystemConfigRepository:
    def test_get_hit(self):
        repo, requests = _supabase(lambda req: httpx.Response(200, json=[{"value": "backend"}]))
        assert repo.get("storage_mode") == "backend"
        req = requests[0]
        assert req.method == "GET"
        assert req.url.path == "/rest/v1/system_configs"
        assert req.url.params["key"] == "eq.storage_mode"

    def test_get_miss_returns_default(self):
        repo, _ = _supabase(lambda req: httpx.Response(200, json=[]))
        assert repo.get("missing", "fallback") == "fallback"

    def test_get_miss_default_empty(self):
        repo, _ = _supabase(lambda req: httpx.Response(200, json=[]))
        assert repo.get("missing") == ""

    def test_set_upserts_with_merge_duplicates(self):
        seen = {}

        def handler(req: httpx.Request) -> httpx.Response:
            seen["prefer"] = req.headers["Prefer"]
            seen["body"] = json.loads(req.content)
            return httpx.Response(201, json=seen["body"])

        repo, requests = _supabase(handler)
        repo.set("storage_mode", "frontend")
        assert requests[0].method == "POST"
        assert "resolution=merge-duplicates" in seen["prefer"]
        assert seen["body"][0]["key"] == "storage_mode"
        assert seen["body"][0]["value"] == "frontend"
        assert seen["body"][0]["updated_at"]  # 显式写入，等价 local 的 onupdate


class TestLocalSystemConfigRepository:
    def test_get_missing_returns_default(self, db_session):
        repo = LocalSystemConfigRepository(db_session)
        assert repo.get("nope", "d") == "d"

    def test_set_then_get_round_trip(self, db_session):
        repo = LocalSystemConfigRepository(db_session)
        repo.set("storage_mode", "backend")
        assert repo.get("storage_mode") == "backend"

    def test_set_overwrites_existing(self, db_session):
        repo = LocalSystemConfigRepository(db_session)
        repo.set("k", "v1")
        repo.set("k", "v2")
        assert repo.get("k") == "v2"

    def test_set_commits(self, db_session):
        """repo.set 负责提交（路由层不再持有事务）。"""
        from app.models.system_config import SystemConfig

        LocalSystemConfigRepository(db_session).set("k", "v")
        db_session.expire_all()
        row = db_session.query(SystemConfig).filter_by(key="k").one()
        assert row.value == "v"
