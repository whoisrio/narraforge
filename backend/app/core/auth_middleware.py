"""Supabase Auth 用户认证中间件（M3，仅 workers 模式注册）。

取代 AccessEnforcementMiddleware（共享口令时代），身份优先级：

1. 旧凭证通道（向后兼容，任一满足即视为 legacy admin，放行一切）：
   - ``Cf-Access-Authenticated-User-Email`` 头存在（CF Access 边缘注入）；
   - ``X-Narraforge-Gateway-Secret`` == settings.gateway_secret（HF Spaces 网关）；
   - ``Authorization: Bearer <token>`` == settings.access_token（共享口令）。
   命中 → ``request.state.user = None``、``request.state.legacy_admin = True``
   （legacy admin 在仓储层看全部行，见 repositories/deps.py）。
2. Supabase Auth 用户 JWT：``Authorization: Bearer <jwt>``，经 JWKS
   （``{SUPABASE_URL}/auth/v1/.well-known/jwks.json``，ES256，TTL 缓存）验签，
   校验 audience（settings.supabase_jwt_aud）与 issuer（``{supabase_url}/auth/v1``）。
   成功 → ``request.state.user = {"id": sub, "email": email}``。
3. 匿名（无/无效/过期 JWT）：只允许无状态 allowlist（模块顶部常量，易扩展），
   其余 → 401 ``{detail: {code: "auth_required"}}``（信封与全局异常处理一致）。

OPTIONS 预检恒放行（CORS 由更外层的 CORSMiddleware 处理）。
"""
from __future__ import annotations

import hmac
import logging
import time

import httpx
import jwt
from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.config import settings

logger = logging.getLogger(__name__)

ACCESS_EMAIL_HEADER = "cf-access-authenticated-user-email"
GATEWAY_SECRET_HEADER = "x-narraforge-gateway-secret"
AUTHORIZATION_HEADER = "authorization"
_BEARER_PREFIX = "bearer "

# 匿名 allowlist：无状态端点（不读/写用户数据）。精确匹配（方法 + 路径）。
_ANON_EXACT = frozenset({
    ("GET", "/health"),
    ("GET", "/"),
    ("GET", "/api/config/capabilities"),
    ("GET", "/api/config/storage-mode"),
    ("POST", "/api/tts/synthesize"),
})
# 匿名 allowlist：路径前缀匹配（方法 + 前缀）。
_ANON_PREFIX = (
    ("POST", "/api/mimo-tts/"),
    ("POST", "/api/text-split/"),
    ("POST", "/api/subtitle-llm/"),
    ("POST", "/api/text-analysis/"),
)

# JWKS 缓存（模块级单例；kid 未命中时绕过缓存重拉一次，兼容密钥轮换）
_JWKS_CACHE_TTL_SECONDS = 600.0
_jwks_cache: dict = {"keys": [], "url": "", "fetched_at": 0.0}


def _load_jwks() -> list[dict]:
    """拉取 Supabase JWKS（TTL 缓存）。测试 monkeypatch 本函数，无网络。"""
    url = f"{settings.supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json"
    now = time.monotonic()
    if (
        _jwks_cache["keys"]
        and _jwks_cache["url"] == url
        and now - _jwks_cache["fetched_at"] < _JWKS_CACHE_TTL_SECONDS
    ):
        return _jwks_cache["keys"]
    resp = httpx.get(url, timeout=10)
    resp.raise_for_status()
    keys = resp.json().get("keys", [])
    _jwks_cache.update(keys=keys, url=url, fetched_at=now)
    return keys


def _find_signing_key(keys: list[dict], kid: str | None):
    for jwk_dict in keys:
        if kid is None or jwk_dict.get("kid") == kid:
            try:
                return jwt.PyJWK.from_dict(jwk_dict).key
            except Exception:  # 单个 JWK 形态异常不拖垮整体
                continue
    return None


def verify_supabase_jwt(token: str) -> dict | None:
    """验签成功返回 {"id", "email"}；任何失败（无效/过期/网络/JWKS 异常）返回 None。

    返回 None 由调用方按匿名处理（allowlist 之外再 401），不在此处直接拒绝。
    """
    try:
        kid = jwt.get_unverified_header(token).get("kid")
        keys = _load_jwks()
        key = _find_signing_key(keys, kid)
        if key is None:
            # kid 未命中：可能是密钥轮换，绕过缓存重拉一次
            _jwks_cache["fetched_at"] = 0.0
            key = _find_signing_key(_load_jwks(), kid)
        if key is None:
            return None
        payload = jwt.decode(
            token,
            key,
            algorithms=["ES256"],
            audience=settings.supabase_jwt_aud,
            issuer=f"{settings.supabase_url.rstrip('/')}/auth/v1",
        )
    except Exception:
        return None
    sub = payload.get("sub")
    if not sub:
        return None
    return {"id": sub, "email": payload.get("email") or ""}


def _has_legacy_credentials(request: Request) -> bool:
    """旧凭证通道三选一（Access 邮箱头 / 网关共享密钥 / Bearer 共享口令）。"""
    if request.headers.get(ACCESS_EMAIL_HEADER):
        return True
    if settings.gateway_secret and hmac.compare_digest(
        request.headers.get(GATEWAY_SECRET_HEADER, ""), settings.gateway_secret
    ):
        return True
    if settings.access_token:
        auth = request.headers.get(AUTHORIZATION_HEADER, "")
        # scheme 大小写不敏感（RFC 9110），口令本体精确比对
        if auth.lower().startswith(_BEARER_PREFIX) and hmac.compare_digest(
            auth[len(_BEARER_PREFIX):], settings.access_token
        ):
            return True
    return False


def _bearer_token(request: Request) -> str | None:
    auth = request.headers.get(AUTHORIZATION_HEADER, "")
    if auth.lower().startswith(_BEARER_PREFIX):
        return auth[len(_BEARER_PREFIX):]
    return None


def _is_anonymous_allowed(method: str, path: str) -> bool:
    if (method, path) in _ANON_EXACT:
        return True
    return any(method == m and path.startswith(prefix) for m, prefix in _ANON_PREFIX)


class SupabaseAuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        # 默认匿名；local 模式不注册本中间件（state 无这两属性，getattr 兜底）
        request.state.user = None
        request.state.legacy_admin = False

        if request.method == "OPTIONS":
            return await call_next(request)

        if _has_legacy_credentials(request):
            request.state.legacy_admin = True
            return await call_next(request)

        token = _bearer_token(request)
        if token:
            user = verify_supabase_jwt(token)
            if user is not None:
                request.state.user = user
                return await call_next(request)

        if _is_anonymous_allowed(request.method, request.url.path):
            return await call_next(request)
        return JSONResponse(
            status_code=401,
            content={
                "detail": {
                    "code": "auth_required",
                    "message": "Sign in required for this resource",
                }
            },
        )
