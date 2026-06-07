"""文本拆分与 SSML 标注服务。

三个能力：
- rule_split: 纯本地，按用户指定的标点切分
- llm_split: 调 LLM 按语义切分
- ssml_annotate: 调 LLM 为段落自动添加 SSML 标签
"""

import json
import logging
import re
from dataclasses import dataclass

from app.services.llm_client import call_llm, extract_json_array

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# rule_split
# ---------------------------------------------------------------------------

def rule_split(text: str, delimiters: list[str]) -> list[str]:
    """按指定标点切分文本。保留标点在段尾。过滤空白段和纯标点段。"""
    if not text or not text.strip():
        return []

    if not delimiters:
        stripped = text.strip()
        return [stripped] if stripped else []

    # 构造正则：在标点之后切分（保留标点在前段）
    escaped = [re.escape(d) for d in delimiters]
    pattern = re.compile(f"(?<=[{''.join(escaped)}])")
    parts = pattern.split(text)

    result: list[str] = []
    for p in parts:
        s = p.strip()
        if not s:
            continue
        # 过滤纯标点段（仅由 delimiters 中的字符组成）
        if all(c in delimiters for c in s):
            continue
        result.append(s)
    return result
