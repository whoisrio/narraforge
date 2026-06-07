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


# ---------------------------------------------------------------------------
# llm_split
# ---------------------------------------------------------------------------

@dataclass
class SplitResult:
    segments: list[dict]   # [{"text": str, "reason": str}]
    model: str | None


# Re-export so monkeypatch in tests can target this module's binding.
from app.services.llm_client import get_llm_config  # noqa: E402


_SPLIT_PROMPT_TEMPLATE = """你是中文文本分句助手。请将下面这段文本按语义和语气节奏拆成多个短句，便于
逐句进行语音合成。

要求：
- 严格保留原文一字不改，仅在合适位置切分
- 每段控制在 5-40 字
- 在语气转折、停顿点、并列结构处切分
- 输出 JSON 数组：[{{"text": "...", "reason": "切分理由"}}]
- 不要包含任何 markdown、解释或额外说明，直接输出 JSON

文本：
{text}
"""


def llm_split(text: str, delimiters: list[str] | None = None, db=None) -> SplitResult:
    """调 LLM 智能拆分。失败抛 ValueError / RuntimeError。"""
    if not text or not text.strip():
        raise ValueError("文本不能为空")

    _, _, model = get_llm_config(db=db)
    prompt = _SPLIT_PROMPT_TEMPLATE.format(text=text)
    raw = call_llm(
        [{"role": "user", "content": prompt}],
        temperature=0.2, max_tokens=4096, db=db, timeout=30,
    )

    json_str = extract_json_array(raw)
    if json_str is None:
        logger.error(f"LLM split: 无法从返回中提取 JSON: {raw[:200]}")
        raise ValueError(f"LLM 返回内容无法解析为 JSON 数组: {raw[:100]}")

    try:
        parsed = json.loads(json_str)
    except json.JSONDecodeError as e:
        raise ValueError(f"JSON 解析失败: {e}")

    segments = []
    for item in parsed:
        if isinstance(item, dict) and "text" in item:
            segments.append({
                "text": str(item.get("text", "")).strip(),
                "reason": str(item.get("reason", "")),
            })
        elif isinstance(item, str):
            segments.append({"text": item.strip(), "reason": ""})

    segments = [s for s in segments if s["text"]]
    if not segments:
        raise ValueError("LLM 返回了空的拆分结果")

    return SplitResult(segments=segments, model=model)
