"""使用统计中间件（M5，仅 workers 模式注册）。

注册顺序：在 auth 中间件之后 add_middleware = 更外层（Starlette 语义），
``call_next`` 返回后读 ``request.state.user``（scope state 跨中间件共享），
连 auth 拒绝的 401 也计入 ``visit_anon``。

采集内容（全部 best-effort：任何异常只 logger.warning，绝不影响请求）：
- 每个请求：RPC ``increment_metric`` → ``visit_authed`` / ``visit_anon``；
- POST /api/tts/synthesize 与 /api/mimo-tts/* 合成路径：再加 ``synthesize``；
- 已认证用户：upsert ``profiles``（首见插入，刷 last_seen_at）与
  ``daily_active_users``（date, user_id）——进程内去重：DAU 每 (date, user)
  每天一次，profiles 每 (hour, user) 每小时一次，避免每请求两次额外往返；
- 变更类请求（POST/PUT/DELETE，剔除 /health、OPTIONS、/api/admin/ 与
  轮询路径）：插 ``operation_logs``（action 由路径映射 <router>.<verb>）。

同步 httpx Supabase 客户端在 async 中间件里直接调用——与 workers 模式
既有仓储层用法一致（repo 全是 sync 类被 async 端点直接调用）。
"""
from __future__ import annotations

import logging
import time
from datetime import UTC, datetime

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.supabase_client import get_supabase_client

logger = logging.getLogger(__name__)

# operation_logs 的 action 映射：（method, 路径前缀）→ <router>.<verb>。
# 只列有明确语义的；其余走 _fallback_action。
_ACTION_MAP = (
    ("POST", "/api/tts/synthesize", "tts.synthesize"),
    ("POST", "/api/mimo-tts/", "mimo_tts.synthesize"),
    ("POST", "/api/segmented-projects", "segmented_projects.create"),
    ("PUT", "/api/segmented-projects/", "segmented_projects.save"),
    ("DELETE", "/api/segmented-projects/", "segmented_projects.delete"),
    ("POST", "/api/roles", "roles.create"),
    ("PUT", "/api/roles/", "roles.update"),
    ("DELETE", "/api/roles/", "roles.delete"),
    ("POST", "/api/clone/", "clone.create"),
    ("PATCH", "/api/clone/", "clone.update"),
    ("DELETE", "/api/clone/", "clone.delete"),
    ("POST", "/api/projects/", "sources.create"),
    ("DELETE", "/api/projects/", "sources.delete"),
)

# operation_logs 跳过的路径前缀（统计/管理端自访、健康探活）
_LOG_SKIP_PREFIXES = ("/api/admin/", "/health")
# 合成计数路径（visit_* 之外再 +synthesize）
_SYNTH_PATHS = (("POST", "/api/tts/synthesize"),)
_SYNTH_PREFIXES = (("POST", "/api/mimo-tts/"),)

_MUTATION_METHODS = {"POST", "PUT", "DELETE"}

# 进程内去重（review 🟡-1：已认证请求原本每请求 2 次额外 Supabase 往返——
# profiles upsert + DAU upsert；同一 (date, user) 的 DAU 当天只需写一次，
# profiles.last_seen_at 按小时粒度刷新足够）。Serverless 实例回收即重置，
# 代价仅是冷启动后多写一次，可接受。
_dau_seen: set[tuple[str, str]] = set()  # (date, user_id)
_profile_seen: set[tuple[str, str]] = set()  # (hour_bucket, user_id)
_SEEN_MAX = 10000


def _mark_seen(cache: set[tuple[str, str]], key: tuple[str, str]) -> bool:
    """首次出现返回 True（应写库）；集合超上限时清空防内存膨胀。"""
    if key in cache:
        return False
    if len(cache) >= _SEEN_MAX:
        cache.clear()
    cache.add(key)
    return True


def _derive_action(method: str, path: str) -> str:
    for m, prefix, action in _ACTION_MAP:
        if method == m and path.startswith(prefix):
            return action
    return _fallback_action(method, path)


def _fallback_action(method: str, path: str) -> str:
    """兜底 action：/api/<seg>/... → <seg>.<method>（点号/连字符归一）。"""
    parts = [p for p in path.split("/") if p]
    segment = parts[1] if len(parts) > 1 else (parts[0] if parts else "root")
    return f"{segment.replace('-', '_')}.{method.lower()}"


def _is_synthesize(method: str, path: str) -> bool:
    if (method, path) in _SYNTH_PATHS:
        return True
    return any(method == m and path.startswith(p) for m, p in _SYNTH_PREFIXES)


def record_request(request: Request, status: int, duration_ms: int) -> None:
    """采集单请求统计。抛出的异常由中间件捕获（best-effort）。"""
    method = request.method
    path = request.url.path
    user = getattr(request.state, "user", None)
    today = datetime.now(UTC).date().isoformat()

    client = get_supabase_client()

    # 访问量（所有请求，含 auth 拒绝的 401 与 OPTIONS）
    client.rpc(
        "increment_metric",
        {"p_date": today, "p_metric": "visit_authed" if user else "visit_anon"},
    )
    if _is_synthesize(method, path):
        client.rpc("increment_metric", {"p_date": today, "p_metric": "synthesize"})

    if user:
        now = datetime.now(UTC)
        if _mark_seen(_profile_seen, (now.strftime("%Y-%m-%dT%H"), user["id"])):
            client.insert(
                "profiles",
                [{"id": user["id"], "email": user.get("email") or "", "last_seen_at": now.isoformat()}],
                upsert=True,
            )
        if _mark_seen(_dau_seen, (today, user["id"])):
            client.insert(
                "daily_active_users",
                [{"date": today, "user_id": user["id"]}],
                upsert=True,
            )

    if method in _MUTATION_METHODS and not any(
        path.startswith(p) for p in _LOG_SKIP_PREFIXES
    ):
        client.insert(
            "operation_logs",
            [
                {
                    "user_id": user["id"] if user else None,
                    "action": _derive_action(method, path),
                    "method": method,
                    "path": path,
                    "status": status,
                    "duration_ms": duration_ms,
                }
            ],
        )


class StatsMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        start = time.monotonic()
        response = await call_next(request)
        duration_ms = int((time.monotonic() - start) * 1000)
        try:
            record_request(request, response.status_code, duration_ms)
        except Exception as exc:  # best-effort：统计失败绝不拖垮业务请求
            logger.warning("[stats] record_request failed: %s", exc)
        return response
