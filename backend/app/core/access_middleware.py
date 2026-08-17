"""Cloudflare Access / 网关密钥 / Bearer 口令校验中间件（spec 3.6，仅 workers 模式注册）。

.. deprecated:: M3 起由 app.core.auth_middleware.SupabaseAuthMiddleware 取代
   （create_app 不再注册本中间件）；三条旧凭证通道的判定逻辑已原样搬入
   auth_middleware._has_legacy_credentials。本文件保留供参考，不再使用。

三条凭证路径，任一满足即放行：

1. ``Cf-Access-Authenticated-User-Email`` 头存在——Access 在边缘完成认证后注入；
   workers.dev 子域路由关闭后，API 只走受 Access 保护的自定义域名，
   该头只能来自 Access 边缘——校验头存在即纵深防御（完整 JWT 验签为可选加固，首版不做）。
2. ``settings.gateway_secret`` 非空且请求头 ``X-Narraforge-Gateway-Secret``
   与之相等——HF Spaces 部署形态：Space 私有，无 Access 边缘注入邮箱头，
   由 CF Worker 网关（gateway/）注入共享密钥头，防 hf.space 直连绕过。
3. ``settings.access_token`` 非空且 ``Authorization: Bearer <token>`` 与之相等——
   无域名 Vercel + Pages 直连部署形态：前端解锁页持有口令，逐请求带 Bearer 头。

放行：`/health`（监控探活）与 OPTIONS 预检（CORS 由 CORSMiddleware 处理）。
三者都无 → 401，错误信封与全局异常处理一致（{detail: {code, message}}）。
"""
import hmac

from app.core.config import settings
from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

ACCESS_EMAIL_HEADER = "cf-access-authenticated-user-email"
GATEWAY_SECRET_HEADER = "x-narraforge-gateway-secret"
AUTHORIZATION_HEADER = "authorization"
_BEARER_PREFIX = "bearer "
_EXEMPT_PATHS = frozenset({"/health"})


class AccessEnforcementMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if request.method == "OPTIONS" or request.url.path in _EXEMPT_PATHS:
            return await call_next(request)
        if request.headers.get(ACCESS_EMAIL_HEADER):
            return await call_next(request)
        if settings.gateway_secret and hmac.compare_digest(
            request.headers.get(GATEWAY_SECRET_HEADER, ""), settings.gateway_secret
        ):
            return await call_next(request)
        if settings.access_token:
            auth = request.headers.get(AUTHORIZATION_HEADER, "")
            # scheme 大小写不敏感（RFC 9110），口令本体精确比对
            if auth.lower().startswith(_BEARER_PREFIX) and hmac.compare_digest(
                auth[len(_BEARER_PREFIX):], settings.access_token
            ):
                return await call_next(request)
        return JSONResponse(
            status_code=401,
            content={
                "detail": {
                    "code": "access_required",
                    "message": "Cloudflare Access authentication required",
                }
            },
        )
