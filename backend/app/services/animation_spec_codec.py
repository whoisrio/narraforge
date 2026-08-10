"""animation_spec 的 JSON 编解码（纯函数，无 ORM 依赖）。

独立成模块的原因（步骤 5 bundle 瘦身）：workers bundle 不含 sqlalchemy，
而这两个函数原来定义在 segmented_project_service.py（顶层依赖 ORM）；
workers 的 Supabase 仓储也要用它们做行 ↔ dict 转换。
segmented_project_service 继续 re-export，历史 import 路径不变。
"""
from __future__ import annotations

import json
from typing import Any


def _parse_animation_spec(raw: str | None) -> dict[str, Any] | None:
    """P2 v3: 解析 segments.animation_spec_json 字符串为 dict. None / 解析失败 → None."""
    if not raw:
        return None
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return None


def _dump_animation_spec(spec: dict[str, Any] | None) -> str | None:
    """P2 v3: 序列化 dict 为 JSON 字符串. None → None."""
    if spec is None:
        return None
    return json.dumps(spec, ensure_ascii=False)
