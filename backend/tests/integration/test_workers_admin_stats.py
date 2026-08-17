"""M5：使用统计中间件 + 管理后台 API（workers 模式，内存版 PostgREST）。

- StatsMiddleware：visit_authed/visit_anon、synthesize 指标、profiles/
  daily_active_users upsert、operation_logs（action 映射 + 跳过规则）、
  best-effort（Supabase 挂了不影响请求）。
- /api/admin/*：require_admin（非管理员 403 / 匿名 401 / 管理员邮箱 JWT 与
  legacy admin 放行）、overview 形状、users 分页、logs 过滤。
"""
import json
import time
from datetime import UTC, datetime
from unittest.mock import AsyncMock, Mock, patch

import jwt as pyjwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi.testclient import TestClient

import main as main_module
from app.core import auth_middleware, stats_middleware
from app.core.config import settings
from tests.fixtures.postgrest_fake import make_fake_supabase_client

SUPABASE_URL = "https://fake.supabase.co"
ISSUER = f"{SUPABASE_URL}/auth/v1"
ADMIN_EMAIL = "boss@example.com"
USER_ID = "aaaaaaaa-1111-1111-1111-111111111111"
GATEWAY_SECRET_HEADER = "X-Narraforge-Gateway-Secret"

TODAY = datetime.now(UTC).date().isoformat()

_PRIVATE_KEY = ec.generate_private_key(ec.SECP256R1())


def _jwks() -> list[dict]:
    jwk = json.loads(pyjwt.algorithms.ECAlgorithm.to_jwk(_PRIVATE_KEY.public_key()))
    jwk["kid"] = "test-kid"
    return [jwk]


def _token(user_id: str, email: str) -> str:
    return pyjwt.encode(
        {
            "sub": user_id,
            "email": email,
            "aud": "authenticated",
            "iss": ISSUER,
            "exp": int(time.time()) + 3600,
        },
        _PRIVATE_KEY,
        algorithm="ES256",
        headers={"kid": "test-kid"},
    )


@pytest.fixture
def base(monkeypatch):
    """公共接线：workers 模式 + 假 JWKS + 假 PostgREST + 管理员邮箱配置。"""
    monkeypatch.setattr(settings, "deploy_target", "workers")
    monkeypatch.setattr(settings, "supabase_url", SUPABASE_URL)
    monkeypatch.setattr(settings, "supabase_service_key", "service-key")
    monkeypatch.setattr(settings, "gateway_secret", "s3cret")
    monkeypatch.setattr(settings, "admin_emails", ADMIN_EMAIL)
    monkeypatch.setattr(auth_middleware, "_load_jwks", lambda: _jwks())

    client, store = make_fake_supabase_client()
    monkeypatch.setattr("app.core.repositories.deps.get_supabase_client", lambda: client)
    monkeypatch.setattr("app.core.stats_middleware.get_supabase_client", lambda: client)
    monkeypatch.setattr(
        "app.core.system_config_service.get_supabase_client", lambda: client
    )
    return store


@pytest.fixture
def admin_client(base):
    """管理 API 测试：统计中间件关停（避免被测请求自身改写统计数据）。"""
    with patch.object(stats_middleware, "record_request", lambda *a, **k: None):
        app = main_module.create_app("workers")
        with TestClient(app) as test_client:
            yield test_client, base


@pytest.fixture
def stats_client(base):
    """统计中间件测试：中间件真实运行。"""
    app = main_module.create_app("workers")
    with TestClient(app) as test_client:
        yield test_client, base


ADMIN_JWT = {"Authorization": f"Bearer {_token(USER_ID, ADMIN_EMAIL)}"}
USER_JWT = {"Authorization": f"Bearer {_token(USER_ID, 'user@example.com')}"}
LEGACY_ADMIN = {GATEWAY_SECRET_HEADER: "s3cret"}


class TestStatsMiddleware:
    def test_anonymous_visit_counted(self, stats_client):
        client, store = stats_client
        assert client.get("/").status_code == 200
        row = store.tables["daily_stats"][0]
        assert row == {"date": TODAY, "metric": "visit_anon", "count": 1}

    def test_authed_visit_upserts_profile_and_dau(self, stats_client):
        client, store = stats_client
        assert client.get("/", headers=USER_JWT).status_code == 200

        assert {"date": TODAY, "metric": "visit_authed", "count": 1} in store.tables[
            "daily_stats"
        ]
        profile = store.tables["profiles"][0]
        assert profile["id"] == USER_ID
        assert profile["email"] == "user@example.com"
        assert profile["last_seen_at"]
        assert store.tables["daily_active_users"] == [
            {"date": TODAY, "user_id": USER_ID}
        ]

    def test_profile_upsert_keeps_single_row(self, stats_client):
        client, store = stats_client
        client.get("/", headers=USER_JWT)
        client.get("/", headers=USER_JWT)
        assert len(store.tables["profiles"]) == 1
        assert len(store.tables["daily_active_users"]) == 1
        visits = [
            r for r in store.tables["daily_stats"] if r["metric"] == "visit_authed"
        ]
        assert visits[0]["count"] == 2

    def test_synthesize_metric_and_operation_log(self, stats_client):
        client, store = stats_client
        service = Mock()
        service.synthesize = AsyncMock(return_value=(b"\xff\xfb\x90\x00" * 10, "mp3"))
        with patch(
            "app.services.edge_tts_service.get_edge_tts_service", return_value=service
        ):
            resp = client.post(
                "/api/tts/synthesize",
                json={"text": "你好", "engine": "edge_tts", "edge_voice": "zh-CN-XiaoxiaoNeural"},
                headers=USER_JWT,
            )
        assert resp.status_code == 200, resp.text

        metrics = {(r["metric"]): r["count"] for r in store.tables["daily_stats"]}
        assert metrics.get("synthesize") == 1
        assert metrics.get("visit_authed") == 1

        logs = store.tables["operation_logs"]
        assert len(logs) == 1
        log = logs[0]
        assert log["action"] == "tts.synthesize"
        assert log["method"] == "POST"
        assert log["path"] == "/api/tts/synthesize"
        assert log["status"] == 200
        assert log["user_id"] == USER_ID
        assert isinstance(log["duration_ms"], int)

    def test_get_requests_not_logged(self, stats_client):
        client, store = stats_client
        client.get("/", headers=USER_JWT)
        assert store.tables["operation_logs"] == []

    def test_admin_paths_not_logged(self, stats_client):
        """/api/admin/ 路径（含 404 的 POST）不进 operation_logs。"""
        client, store = stats_client
        resp = client.post("/api/admin/anything", headers=LEGACY_ADMIN)
        assert resp.status_code == 404
        assert store.tables["operation_logs"] == []

    def test_stats_failure_never_breaks_request(self, stats_client, monkeypatch):
        """Supabase 不可用 → 仅 warning，请求照常。"""
        monkeypatch.setattr(
            stats_middleware,
            "get_supabase_client",
            lambda: (_ for _ in ()).throw(RuntimeError("boom")),
        )
        client, _ = stats_client
        assert client.get("/", headers=USER_JWT).status_code == 200


class TestAdminAccess:
    def test_anonymous_401(self, admin_client):
        client, _ = admin_client
        resp = client.get("/api/admin/stats/overview")
        assert resp.status_code == 401
        assert resp.json()["detail"]["code"] == "auth_required"

    def test_non_admin_user_403(self, admin_client):
        client, _ = admin_client
        resp = client.get("/api/admin/stats/overview", headers=USER_JWT)
        assert resp.status_code == 403
        assert resp.json()["detail"]["code"] == "admin_required"

    def test_admin_email_jwt_passes(self, admin_client):
        client, _ = admin_client
        resp = client.get("/api/admin/stats/overview", headers=ADMIN_JWT)
        assert resp.status_code == 200

    def test_legacy_admin_passes(self, admin_client):
        client, _ = admin_client
        resp = client.get("/api/admin/stats/overview", headers=LEGACY_ADMIN)
        assert resp.status_code == 200

    def test_admin_router_not_mounted_in_local(self):
        client = TestClient(main_module.create_app("local"))
        assert client.get("/api/admin/stats/overview").status_code == 404


def _seed_stats(store):
    store.tables["profiles"] = [
        {
            "id": USER_ID,
            "email": "user@example.com",
            "created_at": f"{TODAY}T01:00:00+00:00",
            "last_seen_at": f"{TODAY}T02:00:00+00:00",
            "is_admin": False,
        }
    ]
    store.tables["daily_active_users"] = [{"date": TODAY, "user_id": USER_ID}]
    store.tables["daily_stats"] = [
        {"date": TODAY, "metric": "visit_authed", "count": 5},
        {"date": TODAY, "metric": "visit_anon", "count": 3},
        {"date": TODAY, "metric": "synthesize", "count": 2},
    ]
    store.tables["operation_logs"] = [
        {
            "id": 1,
            "user_id": USER_ID,
            "action": "tts.synthesize",
            "method": "POST",
            "path": "/api/tts/synthesize",
            "status": 200,
            "duration_ms": 42,
            "created_at": f"{TODAY}T03:00:00+00:00",
        },
        {
            "id": 2,
            "user_id": None,
            "action": "roles.create",
            "method": "POST",
            "path": "/api/roles",
            "status": 201,
            "duration_ms": 7,
            "created_at": f"{TODAY}T04:00:00+00:00",
        },
    ]


class TestAdminApi:
    def test_overview_shape(self, admin_client):
        client, store = admin_client
        _seed_stats(store)
        resp = client.get("/api/admin/stats/overview", headers=LEGACY_ADMIN)
        assert resp.status_code == 200
        data = resp.json()
        assert data["total_users"] == 1
        assert data["today_dau"] == 1
        assert len(data["dau_series"]) == 30
        assert len(data["visit_series"]) == 30
        today_visits = data["visit_series"][-1]
        assert today_visits == {"date": TODAY, "authed": 5, "anon": 3}
        assert data["dau_series"][-1] == {"date": TODAY, "count": 1}

    def test_users_pagination(self, admin_client):
        client, store = admin_client
        _seed_stats(store)
        resp = client.get("/api/admin/users?page=1&page_size=10", headers=LEGACY_ADMIN)
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 1
        user = data["items"][0]
        assert user["email"] == "user@example.com"
        assert user["last_seen_at"] == f"{TODAY}T02:00:00+00:00"
        assert user["operation_count"] == 1

    def test_logs_filters(self, admin_client):
        client, store = admin_client
        _seed_stats(store)
        # 无过滤：全部，最新在前
        data = client.get("/api/admin/logs", headers=LEGACY_ADMIN).json()
        assert [log["id"] for log in data["items"]] == [2, 1]
        # user_id 过滤
        data = client.get(
            f"/api/admin/logs?user_id={USER_ID}", headers=LEGACY_ADMIN
        ).json()
        assert [log["id"] for log in data["items"]] == [1]
        # action 过滤
        data = client.get("/api/admin/logs?action=roles.create", headers=LEGACY_ADMIN).json()
        assert [log["id"] for log in data["items"]] == [2]
        # date 过滤（不存在的日期 → 空）
        data = client.get("/api/admin/logs?date=2000-01-01", headers=LEGACY_ADMIN).json()
        assert data["items"] == []
        assert data["total"] == 0
