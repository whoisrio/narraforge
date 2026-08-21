"""M4：workers 模式多用户数据隔离（端到端，经真实 deps 工厂 + 内存版 PostgREST）。

create_app("workers") + 真 SupabaseAuthMiddleware（伪造 ES256 JWKS，无网络）
+ deps.get_supabase_client 指向 fake——请求链路：JWT → request.state.user →
deps 工厂 → 带 (owner_id, see_all) 作用域的 Supabase 仓储 → PostgREST 查询。

覆盖：
- select/update/delete 追加 user_id=eq.<id>、insert 写入 user_id；
- 跨用户访问 404（不泄露存在性）；save_project 跨用户抢占防护；
- legacy admin（网关密钥）看全部行；
- 匿名 synthesize 不落库（storage_mode=backend 也按前端存储处理）；
- 已认证 synthesize 正常持久化且行带 user_id。
"""
import json
import time
from unittest.mock import AsyncMock, Mock, patch

import httpx

import jwt as pyjwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi.testclient import TestClient

import main as main_module
from app.core import auth_middleware
from app.core.asset_store import get_asset_store
from app.core.config import settings
from tests.fixtures.postgrest_fake import make_fake_supabase_client

SUPABASE_URL = "https://fake.supabase.co"
ISSUER = f"{SUPABASE_URL}/auth/v1"
USER_A = "aaaaaaaa-1111-1111-1111-111111111111"
USER_B = "bbbbbbbb-2222-2222-2222-222222222222"
GATEWAY_SECRET_HEADER = "X-Narraforge-Gateway-Secret"

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


def _auth(user_id: str, email: str) -> dict:
    return {"Authorization": f"Bearer {_token(user_id, email)}"}


AUTH_A = _auth(USER_A, "a@example.com")
AUTH_B = _auth(USER_B, "b@example.com")
ADMIN = {GATEWAY_SECRET_HEADER: "s3cret"}


class _FakeAssetStore:
    """内存资产存储（避免 workers 模式的 Supabase Storage 网络调用）。"""

    def __init__(self):
        self.objects: dict[str, bytes] = {}

    async def put(self, key: str, data: bytes) -> str:
        self.objects[key] = data
        return key

    async def get(self, key: str) -> bytes | None:
        return self.objects.get(key)

    async def delete(self, key: str) -> None:
        self.objects.pop(key, None)


@pytest.fixture
def workers_client(monkeypatch):
    monkeypatch.setattr(settings, "deploy_target", "workers")
    monkeypatch.setattr(settings, "supabase_url", SUPABASE_URL)
    monkeypatch.setattr(settings, "supabase_service_key", "service-key")
    monkeypatch.setattr(settings, "gateway_secret", "s3cret")
    # 存量隔离用例同用户最多建 1 个项目；配额默认放宽，配额用例自行收紧
    monkeypatch.setattr(settings, "max_projects_per_user", 100)
    monkeypatch.setattr(auth_middleware, "_load_jwks", lambda: _jwks())

    client, store = make_fake_supabase_client()
    # 真实 deps 工厂 + 假 PostgREST：隔离逻辑全链路走真代码
    monkeypatch.setattr("app.core.repositories.deps.get_supabase_client", lambda: client)
    monkeypatch.setattr(
        "app.core.system_config_service.get_supabase_client", lambda: client
    )
    monkeypatch.setattr("app.core.stats_middleware.get_supabase_client", lambda: client)

    asset_store = _FakeAssetStore()
    app = main_module.create_app("workers")
    app.dependency_overrides[get_asset_store] = lambda: asset_store
    with TestClient(app) as test_client:
        yield test_client, store, asset_store
    app.dependency_overrides.clear()


def _queries(store, table: str, method: str | None = None) -> list[dict]:
    return [
        r
        for r in store.requests
        if r["table"] == table and (method is None or r["method"] == method)
    ]


class TestProjectIsolation:
    def _create_project(self, client, headers, project_id="p1"):
        return client.post(
            "/api/segmented-projects",
            json={"id": project_id, "name": "项目", "schema_version": 2, "chapters": []},
            headers=headers,
        )

    def test_insert_stamps_user_id_and_select_filters(self, workers_client):
        client, store, _ = workers_client
        resp = self._create_project(client, AUTH_A)
        assert resp.status_code == 201, resp.text
        row = store.tables["segmented_projects"][0]
        assert row["user_id"] == USER_A
        # 所有 projects 查询都带归属过滤（唯一例外：save_project 的跨用户
        # 防抢占复查——有意不带作用域，只取 id 判存在）
        for q in _queries(store, "segmented_projects"):
            if q["method"] == "POST":
                assert q["body"][0]["user_id"] == USER_A
                continue
            if q["params"].get("user_id") == f"eq.{USER_A}":
                continue
            assert q["params"] == {"id": "eq.p1", "select": "id"}, q

    def test_cross_user_read_and_list(self, workers_client):
        client, _, _ = workers_client
        assert self._create_project(client, AUTH_A).status_code == 201

        assert client.get("/api/segmented-projects", headers=AUTH_A).json()["items"]
        assert client.get("/api/segmented-projects", headers=AUTH_B).json()["items"] == []
        # 跨用户读 → 404（不泄露存在性）
        resp = client.get("/api/segmented-projects/p1", headers=AUTH_B)
        assert resp.status_code == 404

    def test_cross_user_save_does_not_clobber(self, workers_client):
        """跨用户用同 id PUT：404 且不覆盖他人行（防 upsert 抢占）。"""
        client, store, _ = workers_client
        assert self._create_project(client, AUTH_A).status_code == 201

        resp = client.put(
            "/api/segmented-projects/p1",
            json={"id": "p1", "name": "被抢注", "schema_version": 2, "chapters": []},
            headers=AUTH_B,
        )
        assert resp.status_code == 404
        row = store.tables["segmented_projects"][0]
        assert row["name"] == "项目"
        assert row["user_id"] == USER_A

    def test_cross_user_create_same_id_404(self, workers_client):
        client, store, _ = workers_client
        assert self._create_project(client, AUTH_A).status_code == 201
        resp = self._create_project(client, AUTH_B)
        assert resp.status_code == 404
        assert len(store.tables["segmented_projects"]) == 1

    def test_cross_user_chapter_op_404(self, workers_client):
        """章节级操作先验项目归属：跨用户 sync-status → 404。"""
        client, _, _ = workers_client
        resp = client.post(
            "/api/segmented-projects",
            json={
                "id": "p1",
                "name": "项目",
                "schema_version": 2,
                "chapters": [
                    {"id": "c1", "position": 0, "name": "第一章", "segments": []}
                ],
            },
            headers=AUTH_A,
        )
        assert resp.status_code == 201, resp.text
        resp = client.get("/api/segmented-projects/p1/chapters/c1/sync-status", headers=AUTH_B)
        assert resp.status_code == 404
        # 本人正常
        resp = client.get("/api/segmented-projects/p1/chapters/c1/sync-status", headers=AUTH_A)
        assert resp.status_code == 200

    def test_legacy_admin_sees_all(self, workers_client):
        client, store, _ = workers_client
        assert self._create_project(client, AUTH_A).status_code == 201
        assert self._create_project(client, AUTH_B, project_id="p2").status_code == 201

        items = client.get("/api/segmented-projects", headers=ADMIN).json()["items"]
        assert {p["id"] for p in items} == {"p1", "p2"}
        # legacy admin 查询不带 user_id 过滤
        list_queries = [
            q for q in _queries(store, "segmented_projects", "GET") if "order" in q["params"]
        ]
        assert any("user_id" not in q["params"] for q in list_queries)


class TestRoleIsolation:
    def _payload(self, role_id="role-1"):
        return {
            "id": role_id,
            "name": "角色",
            "role_kind": "cast",
            "voice": {"engine": "edge_tts", "params": {}},
            "favorite_styles": [],
        }

    def test_crud_scoped_and_cross_user_404(self, workers_client):
        client, store, _ = workers_client
        assert client.post("/api/roles", json=self._payload(), headers=AUTH_A).status_code == 201
        assert store.tables["roles"][0]["user_id"] == USER_A

        assert client.get("/api/roles", headers=AUTH_B).json()["items"] == []
        assert client.put("/api/roles/role-1", json={"name": "x"}, headers=AUTH_B).status_code == 404
        assert client.delete("/api/roles/role-1", headers=AUTH_B).status_code == 404
        # 本人正常
        assert client.put("/api/roles/role-1", json={"name": "x"}, headers=AUTH_A).status_code == 200

    def test_insert_and_select_carry_scope(self, workers_client):
        client, store, _ = workers_client
        client.post("/api/roles", json=self._payload(), headers=AUTH_A)
        for q in _queries(store, "roles"):
            if q["method"] == "POST":
                assert q["body"][0]["user_id"] == USER_A
            else:
                assert q["params"].get("user_id") == f"eq.{USER_A}", q


class TestTtsHistoryIsolation:
    def test_history_scoped(self, workers_client):
        client, store, _ = workers_client
        base = {
            "text": "x",
            "voice_id": "v",
            "voice_name": "v",
            "audio_format": "mp3",
            "speed": 1.0,
            "volume": 80,
            "pitch": 1.0,
            "instruction": "",
            "language": "Chinese",
            "source": None,
            "created_at": "2026-08-10T01:00:00+00:00",
        }
        store.tables["tts_results"] = [
            {**base, "id": "t1", "audio_path": "k1", "user_id": USER_A},
            {**base, "id": "t2", "audio_path": "k2", "user_id": USER_B},
        ]
        items = client.get("/api/tts/history", headers=AUTH_A).json()["items"]
        assert [i["id"] for i in items] == ["t1"]
        # 跨用户删除 → 404
        assert client.delete("/api/tts/history/t2", headers=AUTH_A).status_code == 404
        # legacy admin 全见
        items = client.get("/api/tts/history", headers=ADMIN).json()["items"]
        assert {i["id"] for i in items} == {"t1", "t2"}


class TestAnonymousSynthesize:
    def _edge_mock(self):
        service = Mock()
        service.synthesize = AsyncMock(return_value=(b"\xff\xfb\x90\x00" * 10, "mp3"))
        return patch(
            "app.services.edge_tts_service.get_edge_tts_service", return_value=service
        )

    def test_anonymous_never_persists_even_in_backend_storage(self, workers_client):
        """匿名 + storage_mode=backend：强制前端存储，只回 base64，不落库/不落资产。"""
        client, store, asset_store = workers_client
        store.tables["system_configs"] = [{"key": "storage_mode", "value": "backend"}]

        with self._edge_mock():
            resp = client.post(
                "/api/tts/synthesize",
                json={"text": "你好", "engine": "edge_tts", "edge_voice": "zh-CN-XiaoxiaoNeural"},
            )
        assert resp.status_code == 200, resp.text
        assert resp.json()["audio_base64"]
        assert store.tables["tts_results"] == []
        assert asset_store.objects == {}

    def test_authenticated_persists_with_user_id(self, workers_client):
        """已认证 + storage_mode=backend：正常持久化，行带 user_id。"""
        client, store, asset_store = workers_client
        store.tables["system_configs"] = [{"key": "storage_mode", "value": "backend"}]

        with self._edge_mock():
            resp = client.post(
                "/api/tts/synthesize",
                json={"text": "你好", "engine": "edge_tts", "edge_voice": "zh-CN-XiaoxiaoNeural"},
                headers=AUTH_A,
            )
        assert resp.status_code == 200, resp.text
        assert "audio_url" in resp.json()
        rows = store.tables["tts_results"]
        assert len(rows) == 1
        assert rows[0]["user_id"] == USER_A
        assert asset_store.objects  # 音频落资产存储


class TestWorkersEngineWhitelist:
    """review 🟡-2：workers 只有 edge_tts/mimo_tts；/api/tts/synthesize 传
    cosyvoice 必须给干净 4xx 而非 dashscope ImportError 500。"""

    def test_cosyvoice_rejected_in_workers(self, workers_client):
        client, _, _ = workers_client
        resp = client.post(
            "/api/tts/synthesize",
            json={"text": "你好", "engine": "cosyvoice", "voice_id": "v1"},
        )
        assert resp.status_code == 400
        assert resp.json()["detail"]["code"] == "engine_unavailable"

    def test_cosyvoice_rejected_for_authenticated_too(self, workers_client):
        client, _, _ = workers_client
        resp = client.post(
            "/api/tts/synthesize",
            json={"text": "你好", "engine": "cosyvoice", "voice_id": "v1"},
            headers=AUTH_A,
        )
        assert resp.status_code == 400


class TestMimoSynthesizeStorage:
    """review 🟠：mimo 合成与 edge 路径同一套持久化语义——匿名强制前端存储
    （不落库/不落资产），已认证 backend 模式走 AssetStore + tts_results 仓储。"""

    def _mimo_mock(self):
        service = Mock()
        service.synthesize_preset = AsyncMock(return_value=b"\xff\xfb\x90\x00" * 10)
        return patch(
            "app.api.mimo_tts.get_mimo_tts_service", new=AsyncMock(return_value=service)
        )

    def test_anonymous_never_persists_even_in_backend_storage(self, workers_client):
        client, store, asset_store = workers_client
        store.tables["system_configs"] = [{"key": "storage_mode", "value": "backend"}]

        with self._mimo_mock():
            resp = client.post(
                "/api/mimo-tts/preset",
                json={"text": "你好", "voice": "冰糖", "format": "mp3"},
            )
        assert resp.status_code == 200, resp.text
        assert resp.json()["audio_base64"]
        assert store.tables["tts_results"] == []
        assert asset_store.objects == {}

    def test_authenticated_persists_via_asset_store(self, workers_client):
        client, store, asset_store = workers_client
        store.tables["system_configs"] = [{"key": "storage_mode", "value": "backend"}]

        with self._mimo_mock():
            resp = client.post(
                "/api/mimo-tts/preset",
                json={"text": "你好", "voice": "冰糖", "format": "mp3"},
                headers=AUTH_A,
            )
        assert resp.status_code == 200, resp.text
        assert "audio_url" in resp.json()
        rows = store.tables["tts_results"]
        assert len(rows) == 1
        assert rows[0]["user_id"] == USER_A
        assert asset_store.objects  # 音频落资产存储而非本地 FS


class TestProjectQuota:
    """每用户 backend 项目配额：普通用户限 1 个，管理员（legacy / admin_emails）不限。

    create_project（POST）与 put_project（PUT upsert 的新建路径）都受配额约束；
    更新已有项目不触发。
    """

    def _create(self, client, headers, project_id: str):
        return client.post(
            "/api/segmented-projects",
            json={"id": project_id, "name": "项目", "schema_version": 2, "chapters": []},
            headers=headers,
        )

    def test_regular_user_limited_to_one(self, workers_client, monkeypatch):
        client, store, _ = workers_client
        monkeypatch.setattr(settings, "max_projects_per_user", 1)

        assert self._create(client, AUTH_A, "p1").status_code == 201
        # 第二个项目 → 409，不落库
        resp = self._create(client, AUTH_A, "p2")
        assert resp.status_code == 409
        assert resp.json()["detail"]["code"] == "project_limit_reached"
        assert len(store.tables["segmented_projects"]) == 1

        # PUT 到新 id（前端 backend 存储的 save 路径）同样被拦
        resp = client.put(
            "/api/segmented-projects/p3",
            json={"id": "p3", "name": "x", "schema_version": 2, "chapters": []},
            headers=AUTH_A,
        )
        assert resp.status_code == 409
        assert len(store.tables["segmented_projects"]) == 1

        # 更新已有项目不受配额约束
        resp = client.put(
            "/api/segmented-projects/p1",
            json={"id": "p1", "name": "改名", "schema_version": 2, "chapters": []},
            headers=AUTH_A,
        )
        assert resp.status_code == 200
        assert store.tables["segmented_projects"][0]["name"] == "改名"

    def test_other_users_unaffected(self, workers_client, monkeypatch):
        """配额按 owner 独立计数：A 占满后 B 仍可建自己的项目。"""
        client, store, _ = workers_client
        monkeypatch.setattr(settings, "max_projects_per_user", 1)

        assert self._create(client, AUTH_A, "p1").status_code == 201
        assert self._create(client, AUTH_B, "q1").status_code == 201
        # B 再建第二个 → 409（B 自己超限）
        assert self._create(client, AUTH_B, "q2").status_code == 409
        assert len(store.tables["segmented_projects"]) == 2

    def test_legacy_admin_unlimited(self, workers_client, monkeypatch):
        client, store, _ = workers_client
        monkeypatch.setattr(settings, "max_projects_per_user", 1)

        for pid in ("a1", "a2", "a3"):
            assert self._create(client, ADMIN, pid).status_code == 201
        assert len(store.tables["segmented_projects"]) == 3

    def test_admin_email_unlimited(self, workers_client, monkeypatch):
        client, store, _ = workers_client
        monkeypatch.setattr(settings, "max_projects_per_user", 1)
        monkeypatch.setattr(settings, "admin_emails", "admin@example.com")
        admin_auth = _auth(USER_A, "admin@example.com")

        for pid in ("a1", "a2"):
            assert self._create(client, admin_auth, pid).status_code == 201
        assert len(store.tables["segmented_projects"]) == 2

    def test_quota_disabled_when_zero(self, workers_client, monkeypatch):
        client, store, _ = workers_client
        monkeypatch.setattr(settings, "max_projects_per_user", 0)

        for pid in ("a1", "a2", "a3"):
            assert self._create(client, AUTH_A, pid).status_code == 201
        assert len(store.tables["segmented_projects"]) == 3


class TestDesignedVoiceQuota:
    """每用户设计音色配额（workers 模式；管理员豁免；preset/克隆不受限）。"""

    def _design(self, client, headers, name: str, *, engine: str = "mimo"):
        return client.post(
            "/api/clone/create-from-design",
            json={
                "audio_base64": "QUFB" * 50 + "QUFBQQ==",  # 解码后 >100 字节
                "engine": engine,
                "name": name,
                "description": "desc",
            },
            headers=headers,
        )

    def _design_count(self, store) -> int:
        return len(store.tables.get("voice_profiles", []))

    def test_regular_user_limited_to_one(self, workers_client, monkeypatch):
        client, store, _ = workers_client
        monkeypatch.setattr(settings, "max_designed_voices_per_user", 1)

        assert self._design(client, AUTH_A, "v1").status_code == 200
        # 第二个设计音色 -> 409，不落库
        resp = self._design(client, AUTH_A, "v2")
        assert resp.status_code == 409
        assert resp.json()["detail"]["code"] == "designed_voice_limit_reached"
        assert self._design_count(store) == 1

    def test_other_users_unaffected(self, workers_client, monkeypatch):
        """配额按 owner 独立计数：A 占满后 B 仍可设计自己的音色。"""
        client, store, _ = workers_client
        monkeypatch.setattr(settings, "max_designed_voices_per_user", 1)

        assert self._design(client, AUTH_A, "v1").status_code == 200
        assert self._design(client, AUTH_B, "v1").status_code == 200
        resp = self._design(client, AUTH_B, "v2")
        assert resp.status_code == 409
        assert self._design_count(store) == 2

    def test_legacy_admin_unlimited(self, workers_client, monkeypatch):
        client, store, _ = workers_client
        monkeypatch.setattr(settings, "max_designed_voices_per_user", 1)

        assert self._design(client, ADMIN, "a1").status_code == 200
        assert self._design(client, ADMIN, "a2").status_code == 200
        assert self._design_count(store) == 2

    def test_admin_email_unlimited(self, workers_client, monkeypatch):
        client, store, _ = workers_client
        monkeypatch.setattr(settings, "max_designed_voices_per_user", 1)
        monkeypatch.setattr(settings, "admin_emails", "admin@example.com")
        admin_auth = _auth(USER_A, "admin@example.com")

        assert self._design(client, admin_auth, "a1").status_code == 200
        assert self._design(client, admin_auth, "a2").status_code == 200

    def test_quota_disabled_when_zero(self, workers_client, monkeypatch):
        client, store, _ = workers_client
        monkeypatch.setattr(settings, "max_designed_voices_per_user", 0)

        assert self._design(client, AUTH_A, "v1").status_code == 200
        assert self._design(client, AUTH_A, "v2").status_code == 200

    def test_preset_engine_not_counted(self, workers_client, monkeypatch):
        """预置音色保存（engine=preset）不是设计音色，不受配额限制。"""
        client, store, _ = workers_client
        monkeypatch.setattr(settings, "max_designed_voices_per_user", 1)

        assert self._design(client, AUTH_A, "d1", engine="mimo").status_code == 200
        # preset 保存不占设计音色名额
        assert self._design(client, AUTH_A, "p1", engine="preset").status_code == 200
        # 但第二个设计音色仍被拦
        resp = self._design(client, AUTH_A, "d2", engine="mimo")
        assert resp.status_code == 409

    def test_project_scoped_design_counts(self, workers_client, monkeypatch):
        """项目内创建的设计音色同样占用配额（全局 + 项目合并计数）。"""
        client, store, _ = workers_client
        monkeypatch.setattr(settings, "max_designed_voices_per_user", 1)

        resp = client.post(
            "/api/clone/create-from-design",
            json={
                "audio_base64": "QUFB" * 50 + "QUFBQQ==",
                "engine": "voxcpm",
                "name": "proj-voice",
                "description": "d",
                "project_id": "p1",
            },
            headers=AUTH_A,
        )
        assert resp.status_code == 200
        # 项目内已有 1 个 -> 全局再设计 -> 409
        resp = self._design(client, AUTH_A, "g1")
        assert resp.status_code == 409
        assert resp.json()["detail"]["code"] == "designed_voice_limit_reached"


class TestTryAnonRateLimit:
    """Try 页匿名限流（spec 2026-08-20-try-page-seo-acquisition-design）：
    单 IP 每日 N 次匿名 edge_tts 合成；已认证用户与管理员不受限。"""

    def _edge_mock(self):
        service = Mock()
        service.synthesize = AsyncMock(return_value=(b"\xff\xfb\x90\x00" * 10, "mp3"))
        return patch(
            "app.services.edge_tts_service.get_edge_tts_service", return_value=service
        )

    def _patch_rate_limit_store(self, monkeypatch, store):
        """把限流存储指向与 workers_client 同一个 fake PostgREST。"""
        from app.core.supabase_client import SupabaseClient

        supa = SupabaseClient(
            "https://fake.supabase.co",
            "service-key",
            transport=httpx.MockTransport(store.handle),
        )
        monkeypatch.setattr(
            "app.core.supabase_client.get_supabase_client", lambda: supa
        )

    def _synthesize(self, client, headers=None):
        return client.post(
            "/api/tts/synthesize",
            json={"text": "你好", "engine": "edge_tts", "edge_voice": "zh-CN-XiaoxiaoNeural"},
            headers=headers,
        )

    def test_anonymous_limited_per_day(self, workers_client, monkeypatch):
        client, store, _ = workers_client
        monkeypatch.setattr(settings, "try_anon_daily_limit", 2)
        self._patch_rate_limit_store(monkeypatch, store)

        with self._edge_mock():
            assert self._synthesize(client).status_code == 200
            assert self._synthesize(client).status_code == 200
            resp = self._synthesize(client)
        assert resp.status_code == 429
        assert resp.json()["detail"]["code"] == "rate_limit_exceeded"
        assert resp.json()["detail"]["limit"] == 2

    def test_authenticated_not_limited(self, workers_client, monkeypatch):
        client, store, _ = workers_client
        monkeypatch.setattr(settings, "try_anon_daily_limit", 1)
        self._patch_rate_limit_store(monkeypatch, store)

        with self._edge_mock():
            for _ in range(3):
                assert self._synthesize(client, headers=AUTH_A).status_code == 200
        # 已认证请求不写限流计数
        assert store.tables.get("rate_limit_counters", []) == []


class TestChapterQuota:
    """free 用户每项目章节上限（workers 模式，仅普通登录用户）。

    只在"增长"时拦截：incoming 章节数 > 上限 且 > 项目现有章节数 → 409
    chapter_limit_reached；已超上限的存量项目仍可保存。legacy admin /
    admin_emails 豁免；0 = 不限制。豁免顺序与 TestProjectQuota 一致。
    """

    def _chapters(self, pid: str, n: int) -> list[dict]:
        return [
            {"id": f"{pid}-c{i}", "position": i, "name": f"第{i}章", "segments": []}
            for i in range(n)
        ]

    def _create(self, client, headers, pid: str, n: int):
        return client.post(
            "/api/segmented-projects",
            json={"id": pid, "name": "项目", "schema_version": 2,
                  "chapters": self._chapters(pid, n)},
            headers=headers,
        )

    def _put(self, client, headers, pid: str, n: int):
        return client.put(
            f"/api/segmented-projects/{pid}",
            json={"id": pid, "name": "项目", "schema_version": 2,
                  "chapters": self._chapters(pid, n)},
            headers=headers,
        )

    def test_regular_user_capped_at_limit(self, workers_client, monkeypatch):
        client, store, _ = workers_client
        monkeypatch.setattr(settings, "max_chapters_per_project", 3)

        # 新建 4 章 → 409，不落库
        resp = self._create(client, AUTH_A, "p1", 4)
        assert resp.status_code == 409
        assert resp.json()["detail"]["code"] == "chapter_limit_reached"
        assert resp.json()["detail"]["limit"] == 3
        assert store.tables["segmented_projects"] == []

        # 3 章合法
        assert self._create(client, AUTH_A, "p1", 3).status_code == 201

        # 增长到 4 章 → 409
        resp = self._put(client, AUTH_A, "p1", 4)
        assert resp.status_code == 409
        assert resp.json()["detail"]["code"] == "chapter_limit_reached"

        # 不增长的保存（3 章）放行
        assert self._put(client, AUTH_A, "p1", 3).status_code == 200

    def test_batch_growth_blocked(self, workers_client, monkeypatch):
        client, _, _ = workers_client
        monkeypatch.setattr(settings, "max_chapters_per_project", 3)

        assert self._create(client, AUTH_A, "p1", 3).status_code == 201
        resp = client.post(
            "/api/segmented-projects/p1/chapters:batch",
            json={"chapters": [
                {"chapter_title": f"第{i}章", "segments": []} for i in range(4)
            ]},
            headers=AUTH_A,
        )
        assert resp.status_code == 409
        assert resp.json()["detail"]["code"] == "chapter_limit_reached"
        # 不增长的 batch（3 章）放行
        resp = client.post(
            "/api/segmented-projects/p1/chapters:batch",
            json={"chapters": [
                {"chapter_title": f"第{i}章", "segments": []} for i in range(3)
            ]},
            headers=AUTH_A,
        )
        assert resp.status_code == 200, resp.text

    def test_over_cap_project_can_save_but_not_grow(self, workers_client, monkeypatch):
        """存量超上限项目：保存放行（不增长），继续增长 409。"""
        client, _, _ = workers_client
        monkeypatch.setattr(settings, "max_chapters_per_project", 100)
        assert self._create(client, AUTH_A, "p1", 4).status_code == 201

        monkeypatch.setattr(settings, "max_chapters_per_project", 3)
        # 4 章 > 上限 3，但不超过现有 4 章 → 放行
        assert self._put(client, AUTH_A, "p1", 4).status_code == 200
        # 缩到 3 章也放行
        assert self._put(client, AUTH_A, "p1", 3).status_code == 200
        # 再增长 → 409
        assert self._put(client, AUTH_A, "p1", 4).status_code == 409

    def test_legacy_admin_unlimited(self, workers_client, monkeypatch):
        client, _, _ = workers_client
        monkeypatch.setattr(settings, "max_chapters_per_project", 3)
        assert self._create(client, ADMIN, "p1", 5).status_code == 201

    def test_admin_email_unlimited(self, workers_client, monkeypatch):
        client, _, _ = workers_client
        monkeypatch.setattr(settings, "max_chapters_per_project", 3)
        monkeypatch.setattr(settings, "admin_emails", "admin@example.com")
        admin_auth = _auth(USER_A, "admin@example.com")
        assert self._create(client, admin_auth, "p1", 5).status_code == 201

    def test_quota_disabled_when_zero(self, workers_client, monkeypatch):
        client, _, _ = workers_client
        monkeypatch.setattr(settings, "max_chapters_per_project", 0)
        assert self._create(client, AUTH_A, "p1", 5).status_code == 201
