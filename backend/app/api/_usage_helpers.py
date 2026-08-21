"""用量计量辅助（Phase 3）：从请求构建 LLM/TTS 用量记录回调。

workers 匿名请求（allowlist 放行的无状态端点）不计量——无用户归属；
local 单租户全量计量。record_event 本身 best-effort（不抛出）。
"""
from __future__ import annotations

from typing import Callable

from fastapi import Request

from app.core.auth_deps import is_workers_anonymous
from app.core.repositories.usage import UsageRepository


def build_llm_usage_sink(
    request: Request,
    usage_repo: UsageRepository,
    *,
    chars: int = 0,
    project_id: str | None = None,
) -> Callable[[dict], None] | None:
    """构建传给 call_llm/call_llm_structured 的 usage_sink；匿名返回 None。

    chars=输入文本字符数（由调用方按端点语义计算）。sink 每次 LLM 尝试都会
    触发（含校验重试），用量逐次累计。
    """
    if is_workers_anonymous(request):
        return None

    def sink(usage: dict) -> None:
        usage_repo.record_event(
            kind="llm",
            chars=chars,
            input_tokens=usage.get("input_tokens", 0),
            output_tokens=usage.get("output_tokens", 0),
            project_id=project_id,
            estimated=usage.get("estimated", False),
        )

    return sink
