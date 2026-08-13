"""步骤 4B/4C：workers 模式 Access 校验中间件 + CORS 配置化（spec 3.6/3.7）。

Access（3.6）：
- workers 模式校验 ``Cf-Access-Authenticated-User-Email`` 头存在（该头由 Access
  边缘注入；workers.dev 路由关闭后头只能来自 Access，是纵深防御）。
- 缺头 → 401 ``{detail: {code: "access_required"}}``；``/health`` 与 OPTIONS
  预检放行；``access_enforcement=False`` 可整体关闭；local 模式不注册该中间件。

CORS（3.7）：
- workers 模式用 ``settings.cors_origins``（部署时填 Pages 域名），
  ``allow_credentials=True``（Access 认证态在 cookie 里）。
- local 保持 ``["*"]`` 不变。注意 Starlette 语义：``allow_credentials=True`` 时
  字面 ``"*"`` 不可用，Starlette 降级为反射请求 Origin（两种模式 ACAO 均为具体
  origin 而非 "*"）。
"""
import pytest
from fastapi.testclient import TestClient

import main as main_module
from app.core.config import Settings, settings

ACCESS_HEADER = "Cf-Access-Authenticated-User-Email"
PAGES_ORIGIN = "https://narraforge.pages.dev"


def _workers_client(monkeypatch, **overrides) -> TestClient:
    for key, value in overrides.items():
        monkeypatch.setattr(settings, key, value)
    return TestClient(main_module.create_app("workers"))


def _preflight(client: TestClient, origin: str):
    return client.options(
        "/api/tts/synthesize",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )


class TestAccessEnforcement:
    def test_missing_header_returns_401(self, monkeypatch):
        client = _workers_client(monkeypatch)
        resp = client.get("/")
        assert resp.status_code == 401
        assert resp.json()["detail"]["code"] == "access_required"

    def test_with_header_passes(self, monkeypatch):
        client = _workers_client(monkeypatch)
        resp = client.get("/", headers={ACCESS_HEADER: "me@example.com"})
        assert resp.status_code == 200

    def test_health_exempt(self, monkeypatch):
        client = _workers_client(monkeypatch)
        resp = client.get("/health")
        assert resp.status_code == 200
        assert resp.json()["status"] == "healthy"

    def test_options_preflight_exempt(self, monkeypatch):
        client = _workers_client(monkeypatch)
        resp = _preflight(client, PAGES_ORIGIN)
        assert resp.status_code != 401

    def test_disabled_by_setting(self, monkeypatch):
        client = _workers_client(monkeypatch, access_enforcement=False)
        assert client.get("/").status_code == 200

    def test_local_mode_has_no_middleware(self):
        """local 模式完全不启用 Access 校验（无头也 200）。"""
        client = TestClient(main_module.create_app("local"))
        assert client.get("/").status_code == 200


GATEWAY_SECRET_HEADER = "X-Narraforge-Gateway-Secret"


class TestGatewaySecret:
    """网关共享密钥通道（HF Spaces 部署：CF Worker 网关注入密钥头，Space 私有
    无 Access 边缘注入邮箱头，故放开第二条凭证路径）。"""

    def test_correct_secret_passes(self, monkeypatch):
        client = _workers_client(monkeypatch, gateway_secret="s3cret")
        resp = client.get("/", headers={GATEWAY_SECRET_HEADER: "s3cret"})
        assert resp.status_code == 200

    def test_wrong_secret_returns_401(self, monkeypatch):
        client = _workers_client(monkeypatch, gateway_secret="s3cret")
        resp = client.get("/", headers={GATEWAY_SECRET_HEADER: "wrong"})
        assert resp.status_code == 401
        assert resp.json()["detail"]["code"] == "access_required"

    def test_secret_channel_disabled_when_unset(self, monkeypatch):
        """gateway_secret 未配置（空串）时密钥通道不生效，带头也 401。"""
        client = _workers_client(monkeypatch, gateway_secret="")
        resp = client.get("/", headers={GATEWAY_SECRET_HEADER: "anything"})
        assert resp.status_code == 401

    def test_email_header_still_passes_with_secret_configured(self, monkeypatch):
        """两条凭证路径并存：配了密钥后 Access 邮箱头依旧有效。"""
        client = _workers_client(monkeypatch, gateway_secret="s3cret")
        resp = client.get("/", headers={ACCESS_HEADER: "me@example.com"})
        assert resp.status_code == 200

    def test_local_mode_unaffected_by_gateway_secret(self, monkeypatch):
        """local 模式不注册中间件：即使配了密钥，无头请求照常放行。"""
        monkeypatch.setattr(settings, "gateway_secret", "s3cret")
        client = TestClient(main_module.create_app("local"))
        assert client.get("/").status_code == 200


class TestAccessToken:
    """Bearer 共享口令通道（无域名 Vercel + Pages 直连部署：前端解锁页持有口令，
    每个请求带 ``Authorization: Bearer <token>``；三条凭证路径任一满足即放行）。"""

    def test_bearer_correct_passes(self, monkeypatch):
        client = _workers_client(monkeypatch, access_token="tok123")
        resp = client.get("/", headers={"Authorization": "Bearer tok123"})
        assert resp.status_code == 200

    def test_bearer_wrong_returns_401(self, monkeypatch):
        client = _workers_client(monkeypatch, access_token="tok123")
        resp = client.get("/", headers={"Authorization": "Bearer wrong"})
        assert resp.status_code == 401
        assert resp.json()["detail"]["code"] == "access_required"

    def test_bearer_channel_disabled_when_unset(self, monkeypatch):
        """access_token 未配置（空串）时 Bearer 通道不生效，带正确格式的头也不放行。"""
        client = _workers_client(monkeypatch, access_token="")
        resp = client.get("/", headers={"Authorization": "Bearer anything"})
        assert resp.status_code == 401

    def test_existing_credentials_not_regressed(self, monkeypatch):
        """配了 access_token 后，既有两种凭证（Access 邮箱头 / 网关密钥）依旧有效。"""
        client = _workers_client(monkeypatch, access_token="tok123", gateway_secret="s3cret")
        assert client.get("/", headers={ACCESS_HEADER: "me@example.com"}).status_code == 200
        assert client.get("/", headers={GATEWAY_SECRET_HEADER: "s3cret"}).status_code == 200

    def test_local_mode_unaffected_by_access_token(self, monkeypatch):
        """local 模式不注册中间件：即使配了口令，无头请求照常放行。"""
        monkeypatch.setattr(settings, "access_token", "tok123")
        client = TestClient(main_module.create_app("local"))
        assert client.get("/").status_code == 200


class TestWorkersCors:
    def test_preflight_allowed_origin(self, monkeypatch):
        client = _workers_client(monkeypatch, cors_origins=[PAGES_ORIGIN])
        resp = _preflight(client, PAGES_ORIGIN)
        assert resp.status_code == 200
        assert resp.headers["access-control-allow-origin"] == PAGES_ORIGIN
        assert resp.headers["access-control-allow-credentials"] == "true"

    def test_preflight_disallowed_origin(self, monkeypatch):
        client = _workers_client(monkeypatch, cors_origins=[PAGES_ORIGIN])
        resp = _preflight(client, "https://evil.example.com")
        assert resp.status_code == 400  # Starlette: Disallowed CORS origin
        assert "access-control-allow-origin" not in resp.headers

    def test_access_401_carries_cors_headers(self, monkeypatch):
        """CORS 是最外层中间件：Access 拒绝的 401 也带 ACAO 头，
        浏览器跨域能读到真实 401 而非 CORS 错误。"""
        client = _workers_client(monkeypatch, cors_origins=[PAGES_ORIGIN])
        resp = client.get("/", headers={"Origin": PAGES_ORIGIN})
        assert resp.status_code == 401
        assert resp.headers["access-control-allow-origin"] == PAGES_ORIGIN

    def test_local_mode_any_origin(self):
        """local 保持 ["*"]：credentials 开启时 Starlette 反射具体 origin（非字面 *）。"""
        client = TestClient(main_module.create_app("local"))
        resp = _preflight(client, "http://localhost:5173")
        assert resp.status_code == 200
        assert resp.headers["access-control-allow-origin"] == "http://localhost:5173"
        assert resp.headers["access-control-allow-credentials"] == "true"


class TestWorkersSettings:
    def test_cors_origins_default(self):
        assert Settings().cors_origins == ["*"]

    def test_cors_origins_csv_kwarg(self):
        s = Settings(cors_origins="https://a.example.com, https://b.example.com")
        assert s.cors_origins == ["https://a.example.com", "https://b.example.com"]

    def test_cors_origins_env_var_csv(self, monkeypatch):
        """环境变量逗号分隔（部署时 [vars] CORS_ORIGINS 同格式）。"""
        monkeypatch.setenv("CORS_ORIGINS", "https://a.example.com,https://b.example.com")
        assert Settings().cors_origins == ["https://a.example.com", "https://b.example.com"]

    def test_access_enforcement_default_true(self):
        assert Settings().access_enforcement is True

    def test_gateway_secret_default_empty(self):
        assert Settings().gateway_secret == ""

    def test_gateway_secret_from_env(self, monkeypatch):
        monkeypatch.setenv("GATEWAY_SECRET", "s3cret")
        assert Settings().gateway_secret == "s3cret"

    def test_access_token_default_empty(self):
        assert Settings().access_token == ""

    def test_access_token_from_env(self, monkeypatch):
        monkeypatch.setenv("ACCESS_TOKEN", "tok123")
        assert Settings().access_token == "tok123"

    def test_workers_mode_skips_local_dir_creation(self, monkeypatch):
        """workers 运行时（Pyodide）FS 只读：Settings 不得 mkdir 本地数据目录。"""
        from pathlib import Path

        calls = []
        monkeypatch.setattr(Path, "mkdir", lambda self, *a, **k: calls.append(self))
        Settings(deploy_target="workers")
        assert calls == []

    def test_local_mode_creates_local_dirs(self, monkeypatch):
        """local 模式行为不变：启动即确保数据目录存在。"""
        from pathlib import Path

        calls = []
        monkeypatch.setattr(Path, "mkdir", lambda self, *a, **k: calls.append(self))
        Settings(deploy_target="local")
        assert calls
