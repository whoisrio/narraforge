"""Phase 3：workers 模式用量计量端点（多用户隔离，内存版 PostgREST 全链路）。

- GET /api/me/usage：匿名 401（不在 allowlist）；已认证 200，按项目分桶且
  只含本人数据；项目名从 segmented_projects 解析；
- GET /api/segmented-projects/{id}/usage：归属经仓储作用域，跨用户 404。
"""
import json
import time

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

_PRIVATE_KEY = ec.generate_private_key(ec.SECP256R1())


def _jwks() -> list[dict]:
    jwk = json.loads(pyjwt.algorithms.ECAlgorithm.to_jwk(_PRIVATE_KEY.public_key()))
    jwk["kid"] = "test-kid"
    return [jwk]


def _auth(user_id: str, email: str) -> dict:
    token = pyjwt.encode(
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
    return {"Authorization": f"Bearer {token}"}


AUTH_A = _auth(USER_A, "a@example.com")
AUTH_B = _auth(USER_B, "b@example.com")


class _FakeAssetStore:
    async def put(self, key: str, data: bytes) -> str:
        return key

    async def get(self, key: str) -> bytes | None:
        return None

    async def delete(self, key: str) -> None:
        pass


@pytest.fixture
def workers_client(monkeypatch):
    monkeypatch.setattr(settings, "deploy_target", "workers")
    monkeypatch.setattr(settings, "supabase_url", SUPABASE_URL)
    monkeypatch.setattr(settings, "supabase_service_key", "service-key")
    monkeypatch.setattr(settings, "max_projects_per_user", 100)
    monkeypatch.setattr(auth_middleware, "_load_jwks", lambda: _jwks())

    client, store = make_fake_supabase_client()
    monkeypatch.setattr("app.core.repositories.deps.get_supabase_client", lambda: client)
    monkeypatch.setattr("app.core.system_config_service.get_supabase_client", lambda: client)
    monkeypatch.setattr("app.core.stats_middleware.get_supabase_client", lambda: client)

    app = main_module.create_app("workers")
    app.dependency_overrides[get_asset_store] = lambda: _FakeAssetStore()
    with TestClient(app) as test_client:
        yield test_client, store
    app.dependency_overrides.clear()


def _seed_usage(store, **row):
    base = {
        "id": f"ev-{len(store.tables['usage_events'])}",
        "user_id": USER_A,
        "project_id": "p1",
        "kind": "tts",
        "chars": 0,
        "input_tokens": 0,
        "output_tokens": 0,
        "estimated": False,
        "created_at": "2026-08-21T00:00:00+00:00",
    }
    base.update(row)
    store.tables["usage_events"].append(base)


def _create_project(client, headers, project_id="p1", name="项目甲"):
    resp = client.post(
        "/api/segmented-projects",
        json={"id": project_id, "name": name, "schema_version": 2, "chapters": []},
        headers=headers,
    )
    assert resp.status_code == 201, resp.text


class TestMeUsageWorkers:
    def test_anonymous_401(self, workers_client):
        client, _ = workers_client
        resp = client.get("/api/me/usage")
        assert resp.status_code == 401

    def test_authed_breakdown_and_isolation(self, workers_client):
        client, store = workers_client
        _create_project(client, AUTH_A, "p1", "项目甲")
        _seed_usage(store, chars=10)
        _seed_usage(store, kind="llm", chars=20, input_tokens=8, output_tokens=4)
        _seed_usage(store, project_id=None, kind="llm", chars=5, input_tokens=2, output_tokens=1)
        # 其他用户的事件不计入
        _seed_usage(store, user_id=USER_B, chars=999)

        resp = client.get("/api/me/usage", headers=AUTH_A)
        assert resp.status_code == 200, resp.text
        body = resp.json()
        projects = {p["project_id"]: p for p in body["projects"]}
        assert projects["p1"] == {
            "project_id": "p1", "project_name": "项目甲",
            "tts_count": 1, "chars": 30, "input_tokens": 8, "output_tokens": 4,
        }
        assert projects[None]["chars"] == 5
        assert body["totals"] == {
            "tts_count": 1, "chars": 35, "input_tokens": 10, "output_tokens": 5,
        }

    def test_other_user_sees_nothing(self, workers_client):
        client, store = workers_client
        _seed_usage(store, chars=10)

        resp = client.get("/api/me/usage", headers=AUTH_B)
        assert resp.status_code == 200, resp.text
        assert resp.json()["projects"] == []
        assert resp.json()["totals"]["chars"] == 0


class TestProjectUsageWorkers:
    def test_owner_gets_sums(self, workers_client):
        client, store = workers_client
        _create_project(client, AUTH_A, "p1")
        _seed_usage(store, chars=10)
        _seed_usage(store, chars=6)
        _seed_usage(store, kind="llm", chars=100, input_tokens=40, output_tokens=15)
        _seed_usage(store, project_id="p2", chars=999)  # 其他项目不计入

        resp = client.get("/api/segmented-projects/p1/usage", headers=AUTH_A)
        assert resp.status_code == 200, resp.text
        assert resp.json() == {
            "project_id": "p1",
            "tts_count": 2,
            "chars": 116,
            "input_tokens": 40,
            "output_tokens": 15,
        }

    def test_cross_user_404(self, workers_client):
        client, store = workers_client
        _create_project(client, AUTH_A, "p1")
        _seed_usage(store, chars=10)

        resp = client.get("/api/segmented-projects/p1/usage", headers=AUTH_B)
        assert resp.status_code == 404
