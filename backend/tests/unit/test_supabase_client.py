"""步骤 3A：Supabase PostgREST httpx 客户端（workers 运行时唯一可用的持久化通道）。

Pyodide 没有原生 socket，psycopg/asyncpg 不可用，只能走 HTTPS REST。
客户端用 httpx 同步 Client（spike 已验证 httpx 在 Pyodide 可用），
transport 可注入，测试用 httpx.MockTransport 录制请求/响应。
"""
import json

import httpx
import pytest

from app.core.config import settings
from app.core.supabase_client import (
    SupabaseClient,
    SupabaseError,
    get_supabase_client,
)

BASE = "https://test.supabase.co"


def _make_client(handler) -> tuple[SupabaseClient, list[httpx.Request]]:
    requests: list[httpx.Request] = []

    def _handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return handler(request)

    client = SupabaseClient(BASE, "service-key", transport=httpx.MockTransport(_handler))
    return client, requests


class TestRequestBasics:
    def test_auth_headers_and_base_url(self):
        client, requests = _make_client(lambda req: httpx.Response(200, json=[]))
        client.select("system_configs")
        req = requests[0]
        assert req.url.path == "/rest/v1/system_configs"
        assert req.headers["apikey"] == "service-key"
        assert req.headers["Authorization"] == "Bearer service-key"

    def test_trailing_slash_in_base_url_tolerated(self):
        client = SupabaseClient(f"{BASE}/", "k", transport=httpx.MockTransport(
            lambda req: httpx.Response(200, json=[])))
        assert client.select("roles") == []

    def test_missing_credentials_rejected(self):
        with pytest.raises(ValueError):
            SupabaseClient("", "key")
        with pytest.raises(ValueError):
            SupabaseClient(BASE, "")


class TestSelect:
    def test_select_passes_filters_and_returns_rows(self):
        def handler(req: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json=[{"id": "r1", "name": "林夏"}])

        client, requests = _make_client(handler)
        rows = client.select("roles", params={"project_id": "is.null", "order": "updated_at.desc"})
        assert rows == [{"id": "r1", "name": "林夏"}]
        assert requests[0].url.params["project_id"] == "is.null"
        assert requests[0].url.params["order"] == "updated_at.desc"

    def test_select_one_returns_first_row(self):
        client, _ = _make_client(lambda req: httpx.Response(200, json=[{"key": "k", "value": "v"}]))
        assert client.select_one("system_configs", params={"key": "eq.k"}) == {"key": "k", "value": "v"}

    def test_select_one_empty_returns_none(self):
        client, _ = _make_client(lambda req: httpx.Response(200, json=[]))
        assert client.select_one("system_configs", params={"key": "eq.missing"}) is None


class TestInsert:
    def test_insert_posts_rows_with_return_representation(self):
        def handler(req: httpx.Request) -> httpx.Response:
            assert req.headers["Prefer"] == "return=representation"
            body = json.loads(req.content)
            assert body == [{"id": "r1", "name": "林夏"}]
            return httpx.Response(201, json=body)

        client, requests = _make_client(handler)
        rows = client.insert("roles", [{"id": "r1", "name": "林夏"}])
        assert requests[0].method == "POST"
        assert rows == [{"id": "r1", "name": "林夏"}]

    def test_insert_upsert_adds_merge_duplicates(self):
        seen = {}

        def handler(req: httpx.Request) -> httpx.Response:
            seen["prefer"] = req.headers["Prefer"]
            return httpx.Response(201, json=[{"key": "k", "value": "v"}])

        client, _ = _make_client(handler)
        client.insert("system_configs", [{"key": "k", "value": "v"}], upsert=True)
        assert "resolution=merge-duplicates" in seen["prefer"]
        assert "return=representation" in seen["prefer"]


class TestUpdateDelete:
    def test_update_patches_with_filter(self):
        def handler(req: httpx.Request) -> httpx.Response:
            assert req.headers["Prefer"] == "return=representation"
            return httpx.Response(200, json=[{"id": "r1", "name": "新版"}])

        client, requests = _make_client(handler)
        rows = client.update("roles", {"name": "新版"}, params={"id": "eq.r1"})
        assert requests[0].method == "PATCH"
        assert requests[0].url.params["id"] == "eq.r1"
        assert json.loads(requests[0].content) == {"name": "新版"}
        assert rows == [{"id": "r1", "name": "新版"}]

    def test_update_no_match_returns_empty(self):
        client, _ = _make_client(lambda req: httpx.Response(200, json=[]))
        assert client.update("roles", {"name": "x"}, params={"id": "eq.missing"}) == []

    def test_delete_returns_deleted_rows(self):
        client, requests = _make_client(lambda req: httpx.Response(200, json=[{"id": "r1"}]))
        rows = client.delete("roles", params={"id": "eq.r1"})
        assert requests[0].method == "DELETE"
        assert rows == [{"id": "r1"}]

    def test_delete_no_match_returns_empty(self):
        client, _ = _make_client(lambda req: httpx.Response(200, json=[]))
        assert client.delete("roles", params={"id": "eq.missing"}) == []


class TestErrorMapping:
    @pytest.mark.parametrize("status", [400, 401, 404, 409, 500])
    def test_non_2xx_raises_supabase_error(self, status: int):
        client, _ = _make_client(
            lambda req: httpx.Response(status, json={"message": "boom", "code": "PGRST100"}))
        with pytest.raises(SupabaseError) as exc_info:
            client.select("roles")
        assert exc_info.value.status_code == status
        assert "boom" in str(exc_info.value)

    def test_error_with_non_json_body(self):
        client, _ = _make_client(lambda req: httpx.Response(502, text="Bad Gateway"))
        with pytest.raises(SupabaseError) as exc_info:
            client.select("roles")
        assert exc_info.value.status_code == 502

    def test_409_conflict_exposed_for_caller_mapping(self):
        """仓储层需要区分唯一冲突（映射为领域错误，如 role_already_exists）。"""
        client, _ = _make_client(lambda req: httpx.Response(409, json={"code": "23505"}))
        with pytest.raises(SupabaseError) as exc_info:
            client.insert("roles", [{"id": "r1"}])
        assert exc_info.value.status_code == 409


class TestFactory:
    def test_get_supabase_client_from_settings(self, monkeypatch):
        monkeypatch.setattr(settings, "supabase_url", BASE)
        monkeypatch.setattr(settings, "supabase_service_key", "k")
        client = get_supabase_client()
        assert isinstance(client, SupabaseClient)

    def test_get_supabase_client_unconfigured_raises(self, monkeypatch):
        monkeypatch.setattr(settings, "supabase_url", "")
        monkeypatch.setattr(settings, "supabase_service_key", "")
        with pytest.raises(RuntimeError, match="(?i)supabase"):
            get_supabase_client()
