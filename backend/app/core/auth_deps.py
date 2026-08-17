"""请求级身份依赖（M3，workers 模式）。

local 模式不注册认证中间件，request.state 没有 user/legacy_admin 属性
（getattr 兜底为匿名）；require_* 只挂在 workers-only 路由上（/api/admin/*），
repo 挂载路由的匿名拦截由 SupabaseAuthMiddleware 的 allowlist 统一完成
（匿名在仓储层另有 user_id IS NULL 兜底作用域，见 repositories/deps.py）。
"""
from __future__ import annotations

from fastapi import HTTPException, Request

from app.core.config import settings


async def get_current_user(request: Request) -> dict | None:
    """当前登录用户 {"id", "email"}；匿名/legacy admin 返回 None。"""
    return getattr(request.state, "user", None)


async def require_user(request: Request) -> dict | None:
    """要求已认证（用户 JWT 或 legacy admin），否则 401。"""
    user = getattr(request.state, "user", None)
    if user is not None or getattr(request.state, "legacy_admin", False):
        return user
    raise HTTPException(
        status_code=401,
        detail={"code": "auth_required", "message": "Sign in required for this resource"},
    )


async def require_admin(request: Request) -> None:
    """要求管理员：legacy admin 恒通过；用户 JWT 需 email ∈ settings.admin_emails。"""
    if getattr(request.state, "legacy_admin", False):
        return
    user = getattr(request.state, "user", None)
    if user and (user.get("email") or "").lower() in settings.admin_email_list:
        return
    raise HTTPException(
        status_code=403,
        detail={"code": "admin_required", "message": "Admin privileges required"},
    )
