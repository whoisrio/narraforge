"""Try 页匿名合成限流：单 IP 每日 50 次 edge_tts 合成。

仅作用于 workers 模式下的匿名请求（已认证用户与 local 模式不限）。
workers 用 Supabase 表计数（serverless 多实例共享），local/测试用内存计数。
存储故障 fail-open（log warning，不阻断功能）——与 stats 中间件同策略。

设计：docs/superpowers/specs/2026-08-20-try-page-seo-acquisition-design.md
"""
from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Protocol

from fastapi import HTTPException, Request

from app.core.auth_deps import is_workers_anonymous
from app.core.config import settings

logger = logging.getLogger(__name__)

_SCOPE = "try_edge_tts"


class RateLimitStore(Protocol):
    """原子 +1 并返回新计数。实现必须原子（并发下不超发）。"""

    def hit(self, key: str, day: str) -> int: ...


class InMemoryRateLimitStore:
    """单进程内存计数（local 模式与单元测试）。"""

    def __init__(self) -> None:
        self._counts: dict[tuple[str, str], int] = {}

    def hit(self, key: str, day: str) -> int:
        k = (key, day)
        self._counts[k] = self._counts.get(k, 0) + 1
        return self._counts[k]


class SupabaseRateLimitStore:
    """workers 模式：经 RPC hit_rate_limit 原子 +1（见 backend/supabase/schema.sql）。"""

    def __init__(self, client) -> None:
        self._client = client

    def hit(self, key: str, day: str) -> int:
        result = self._client.rpc("hit_rate_limit", {"p_key": key, "p_day": day})
        return int(result)


_IN_MEMORY_STORE = InMemoryRateLimitStore()


def get_rate_limit_store() -> RateLimitStore:
    if settings.deploy_target == "workers":
        # 延迟 import：local 模式不装 supabase 依赖链也能 import 本模块
        from app.core.supabase_client import get_supabase_client

        return SupabaseRateLimitStore(get_supabase_client())
    return _IN_MEMORY_STORE


def get_client_ip(request: Request) -> str:
    """CF-Connecting-IP（Cloudflare 边缘注入）→ X-Forwarded-For 首跳 → 直连地址。"""
    cf_ip = request.headers.get("cf-connecting-ip")
    if cf_ip:
        return cf_ip.strip()
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()
    if request.client:
        return request.client.host
    return "unknown"


def enforce_try_rate_limit(request: Request) -> None:
    """匿名 workers 请求超限时抛 429；其余场景（已认证/local）直接放行。"""
    if not is_workers_anonymous(request):
        return
    key = f"{_SCOPE}:{get_client_ip(request)}"
    day = datetime.now(UTC).date().isoformat()
    try:
        count = get_rate_limit_store().hit(key, day)
    except Exception:
        logger.warning("rate limit store unavailable, failing open", exc_info=True)
        return
    if count > settings.try_anon_daily_limit:
        raise HTTPException(
            status_code=429,
            detail={
                "code": "rate_limit_exceeded",
                "message": "Daily free trial limit reached. Sign up for the full version to continue.",
                "limit": settings.try_anon_daily_limit,
            },
        )
