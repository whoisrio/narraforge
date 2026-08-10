"""Cloudflare Access 校验中间件（spec 3.6，仅 workers 模式注册）。

Access 在边缘完成认证后注入 ``Cf-Access-Authenticated-User-Email`` 头；
workers.dev 子域路由关闭后，API 只走受 Access 保护的自定义域名，
该头只能来自 Access 边缘——校验头存在即纵深防御（完整 JWT 验签为可选加固，首版不做）。

放行：`/health`（监控探活）与 OPTIONS 预检（CORS 由 CORSMiddleware 处理）。
缺头 → 401，错误信封与全局异常处理一致（{detail: {code, message}}）。
"""
from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

ACCESS_EMAIL_HEADER = "cf-access-authenticated-user-email"
_EXEMPT_PATHS = frozenset({"/health"})


class AccessEnforcementMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if request.method == "OPTIONS" or request.url.path in _EXEMPT_PATHS:
            return await call_next(request)
        if not request.headers.get(ACCESS_EMAIL_HEADER):
            return JSONResponse(
                status_code=401,
                content={
                    "detail": {
                        "code": "access_required",
                        "message": "Cloudflare Access authentication required",
                    }
                },
            )
        return await call_next(request)
