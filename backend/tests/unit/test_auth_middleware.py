"""M3：Supabase Auth 认证中间件 + JWKS 验签 + 匿名 allowlist + 旧凭证兼容。

伪造 ES256 密钥对 + monkeypatch ``_load_jwks``（无网络）：
- 有效/无效/过期/错 aud/错 iss token；
- 匿名 allowlist 放行、非 allowlist 401（code=auth_required）；
- 旧凭证三通道（Access 邮箱头/网关密钥/共享口令）→ legacy admin 放行；
- settings 新增项（supabase_jwt_aud / admin_emails）解析。
"""
import json
import time

import jwt as pyjwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi import Request
from fastapi.testclient import TestClient

import main as main_module
from app.core import auth_middleware
from app.core.config import Settings, settings

SUPABASE_URL = "https://fake.supabase.co"
ISSUER = f"{SUPABASE_URL}/auth/v1"
USER_ID = "11111111-2222-3333-4444-555555555555"
USER_EMAIL = "user@example.com"

# 非 allowlist 的探针路径：不存在 → 通过中间件后 404，被拦则 401
PROBE = "/api/__protected_probe"

_PRIVATE_KEY = ec.generate_private_key(ec.SECP256R1())


def _jwks() -> list[dict]:
    jwk = json.loads(pyjwt.algorithms.ECAlgorithm.to_jwk(_PRIVATE_KEY.public_key()))
    jwk["kid"] = "test-kid"
    return [jwk]


def _make_token(**overrides) -> str:
    payload = {
        "sub": USER_ID,
        "email": USER_EMAIL,
        "aud": "authenticated",
        "iss": ISSUER,
        "exp": int(time.time()) + 3600,
    }
    payload.update(overrides)
    return pyjwt.encode(payload, _PRIVATE_KEY, algorithm="ES256", headers={"kid": "test-kid"})


@pytest.fixture(autouse=True)
def _fake_jwks(monkeypatch):
    """所有用例共享：JWKS 走内存假数据 + supabase_url 指向假 issuer；
    storage-mode/统计中间件的 Supabase 访问走内存版 PostgREST。"""
    from tests.fixtures.postgrest_fake import make_fake_supabase_client

    fake_client, _ = make_fake_supabase_client()
    monkeypatch.setattr(auth_middleware, "_load_jwks", lambda: _jwks())
    monkeypatch.setattr(settings, "supabase_url", SUPABASE_URL)
    monkeypatch.setattr(
        "app.core.system_config_service.get_supabase_client", lambda: fake_client
    )
    monkeypatch.setattr("app.core.stats_middleware.get_supabase_client", lambda: fake_client)


def _workers_client(monkeypatch, **overrides) -> TestClient:
    # system_config_service 等按 settings.deploy_target 分发 Supabase/本地路径
    monkeypatch.setattr(settings, "deploy_target", "workers")
    for key, value in overrides.items():
        monkeypatch.setattr(settings, key, value)
    app = main_module.create_app("workers")

    @app.get("/api/__whoami")
    async def whoami(request: Request):
        return {
            "user": getattr(request.state, "user", None),
            "legacy_admin": getattr(request.state, "legacy_admin", None),
        }

    return TestClient(app)


class TestJwtVerification:
    def test_valid_token(self):
        user = auth_middleware.verify_supabase_jwt(_make_token())
        assert user == {"id": USER_ID, "email": USER_EMAIL}

    def test_expired_token(self):
        token = _make_token(exp=int(time.time()) - 10)
        assert auth_middleware.verify_supabase_jwt(token) is None

    def test_wrong_audience(self):
        assert auth_middleware.verify_supabase_jwt(_make_token(aud="other")) is None

    def test_wrong_issuer(self):
        token = _make_token(iss="https://evil.example.com/auth/v1")
        assert auth_middleware.verify_supabase_jwt(token) is None

    def test_garbage_token(self):
        assert auth_middleware.verify_supabase_jwt("not-a-jwt") is None

    def test_unknown_kid_triggers_refetch(self, monkeypatch):
        calls = []
        monkeypatch.setattr(
            auth_middleware, "_load_jwks", lambda: (calls.append(1), _jwks())[1]
        )
        other_key = ec.generate_private_key(ec.SECP256R1())
        token = pyjwt.encode(
            {"sub": USER_ID, "aud": "authenticated", "iss": ISSUER,
             "exp": int(time.time()) + 3600},
            other_key, algorithm="ES256", headers={"kid": "rotated-kid"},
        )
        assert auth_middleware.verify_supabase_jwt(token) is None
        assert len(calls) == 2  # kid 未命中 → 绕过缓存重拉一次

    def test_missing_sub(self):
        token = _make_token(sub="")
        assert auth_middleware.verify_supabase_jwt(token) is None


class TestAnonymousAllowlist:
    @pytest.mark.parametrize("path", ["/", "/health", "/api/config/capabilities"])
    def test_allowlisted_get_passes_anonymous(self, monkeypatch, path):
        client = _workers_client(monkeypatch)
        assert client.get(path).status_code == 200

    def test_storage_mode_get_passes_anonymous(self, monkeypatch):
        client = _workers_client(monkeypatch)
        resp = client.get("/api/config/storage-mode")
        assert resp.status_code == 200

    def test_non_allowlist_returns_401(self, monkeypatch):
        client = _workers_client(monkeypatch)
        resp = client.get(PROBE)
        assert resp.status_code == 401
        assert resp.json()["detail"]["code"] == "auth_required"

    def test_invalid_bearer_on_allowlist_path_passes_as_anonymous(self, monkeypatch):
        """无效 JWT 按匿名处理：allowlist 路径放行，非 allowlist 401。"""
        client = _workers_client(monkeypatch)
        resp = client.get("/", headers={"Authorization": "Bearer garbage"})
        assert resp.status_code == 200
        resp = client.get(PROBE, headers={"Authorization": "Bearer garbage"})
        assert resp.status_code == 401

    def test_options_always_allowed(self, monkeypatch):
        client = _workers_client(monkeypatch, cors_origins=["https://app.pages.dev"])
        resp = client.options(
            PROBE,
            headers={
                "Origin": "https://app.pages.dev",
                "Access-Control-Request-Method": "GET",
            },
        )
        assert resp.status_code != 401


class TestAuthenticatedUser:
    def test_valid_jwt_sets_user_state(self, monkeypatch):
        client = _workers_client(monkeypatch)
        resp = client.get("/api/__whoami", headers={"Authorization": f"Bearer {_make_token()}"})
        assert resp.status_code == 200
        assert resp.json() == {
            "user": {"id": USER_ID, "email": USER_EMAIL},
            "legacy_admin": False,
        }

    def test_expired_jwt_falls_back_to_anonymous_401(self, monkeypatch):
        client = _workers_client(monkeypatch)
        token = _make_token(exp=int(time.time()) - 10)
        resp = client.get(PROBE, headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 401


ACCESS_HEADER = "Cf-Access-Authenticated-User-Email"
GATEWAY_SECRET_HEADER = "X-Narraforge-Gateway-Secret"


class TestLegacyCredentials:
    """旧凭证三通道 → legacy admin（state.user=None、legacy_admin=True，放行一切）。"""

    def test_access_email_header(self, monkeypatch):
        client = _workers_client(monkeypatch)
        resp = client.get("/api/__whoami", headers={ACCESS_HEADER: "me@example.com"})
        assert resp.status_code == 200
        assert resp.json() == {"user": None, "legacy_admin": True}

    def test_gateway_secret(self, monkeypatch):
        client = _workers_client(monkeypatch, gateway_secret="s3cret")
        resp = client.get(PROBE, headers={GATEWAY_SECRET_HEADER: "s3cret"})
        assert resp.status_code == 404  # 过了中间件，路径不存在
        assert client.get(PROBE, headers={GATEWAY_SECRET_HEADER: "wrong"}).status_code == 401

    def test_access_token(self, monkeypatch):
        client = _workers_client(monkeypatch, access_token="tok123")
        assert client.get(PROBE, headers={"Authorization": "Bearer tok123"}).status_code == 404
        assert client.get(PROBE, headers={"Authorization": "Bearer wrong"}).status_code == 401

    def test_legacy_channel_disabled_when_unset(self, monkeypatch):
        client = _workers_client(monkeypatch, gateway_secret="", access_token="")
        assert client.get(PROBE, headers={GATEWAY_SECRET_HEADER: "anything"}).status_code == 401

    def test_local_mode_has_no_middleware(self, monkeypatch):
        monkeypatch.setattr(settings, "gateway_secret", "s3cret")
        client = TestClient(main_module.create_app("local"))
        assert client.get(PROBE).status_code == 404  # 无中间件，直接 404


_REAL_LOAD_JWKS = auth_middleware._load_jwks


class TestJwksCache:
    """_load_jwks 的 TTL 缓存（monkeypatch httpx.get，无网络）。"""

    def _stub_http(self, monkeypatch):
        calls = []

        class _Resp:
            def raise_for_status(self):
                pass

            def json(self):
                return {"keys": _jwks()}

        def _get(url, timeout):
            calls.append(url)
            return _Resp()

        monkeypatch.setattr(auth_middleware.httpx, "get", _get)
        monkeypatch.setattr(
            auth_middleware, "_jwks_cache", {"keys": [], "url": "", "fetched_at": 0.0}
        )
        # autouse fixture 替换过 _load_jwks，这里恢复真身
        monkeypatch.setattr(auth_middleware, "_load_jwks", _REAL_LOAD_JWKS)
        return calls

    def test_ttl_cache_hit(self, monkeypatch):
        calls = self._stub_http(monkeypatch)
        assert len(auth_middleware._load_jwks()) == 1
        assert len(auth_middleware._load_jwks()) == 1
        assert len(calls) == 1  # 第二次走缓存
        assert calls[0] == f"{SUPABASE_URL}/auth/v1/.well-known/jwks.json"

    def test_ttl_expiry_refetches(self, monkeypatch):
        calls = self._stub_http(monkeypatch)
        auth_middleware._load_jwks()
        auth_middleware._jwks_cache["fetched_at"] = 0.0  # 强制过期
        auth_middleware._load_jwks()
        assert len(calls) == 2


class TestNewSettings:
    def test_supabase_jwt_aud_default(self):
        assert Settings().supabase_jwt_aud == "authenticated"

    def test_supabase_jwt_aud_from_env(self, monkeypatch):
        monkeypatch.setenv("SUPABASE_JWT_AUD", "custom-aud")
        assert Settings().supabase_jwt_aud == "custom-aud"

    def test_admin_emails_default_empty(self):
        assert Settings().admin_emails == ""
        assert Settings().admin_email_list == []

    def test_admin_email_list_parsing(self):
        s = Settings(admin_emails="A@example.com, b@example.com ,")
        assert s.admin_email_list == ["a@example.com", "b@example.com"]
