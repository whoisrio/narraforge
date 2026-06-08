"""文本拆分与 SSML 标注服务。

三个能力：
- rule_split: 纯本地，按用户指定的标点切分
- llm_split: 调 LLM 按语义切分
- ssml_annotate: 调 LLM 为段落自动添加 SSML 标签
"""

import logging
import re
from dataclasses import dataclass
from typing import Literal

from pydantic import BaseModel, Field

from app.services.llm_client import call_llm_structured

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

Emotion = Literal['happy', 'sad', 'angry', 'calm', 'neutral', 'excited']


class _SplitSegment(BaseModel):
    """LLM 返回的单条拆分结果（schema 用）。"""
    text: str = Field(..., description="切分后的文本片段，必须是原文的连续子串")
    reason: str = Field(default="", description="本次切分的简短理由")
    emotion: Emotion = Field(default="neutral", description="本段的感情色彩")


class _SplitResponse(BaseModel):
    """LLM 顶层响应：response_format=json_object 要求顶层必须是对象。"""
    segments: list[_SplitSegment]


@dataclass
class SplitResult:
    segments: list[dict]   # [{"text": str, "reason": str, "emotion": str}]
    model: str | None


# Re-export so monkeypatch in tests can target this module's binding.
from app.services.llm_client import get_llm_config  # noqa: E402


_SPLIT_PROMPT_TEMPLATE = """你是中文文本分句助手。请将下面这段文本按语义和语气节奏拆成多个短句，便于
逐句进行语音合成。

要求：
- 严格保留原文一字不改，仅在合适位置切分
- 每段控制在 5-40 字
- 在语气转折、停顿点、并列结构处切分
{delimiter_hint}
- 判断每段的感情色彩，从以下选项中选一个：happy(欣喜/积极)、sad(沉重/悲伤)、angry(愤怒/激烈)、calm(沉稳/平和)、neutral(中性/陈述)、excited(激昂/振奋)
- 输出 JSON 对象，结构为 {{"segments": [{{"text": "...", "reason": "切分理由", "emotion": "neutral"}}, ...]}}

文本：
{text}
"""


def llm_split(text: str, delimiters: list[str] | None = None, db=None) -> SplitResult:
    """调 LLM 智能拆分。失败抛 ValueError / RuntimeError / LLMValidationError。"""
    if not text or not text.strip():
        raise ValueError("文本不能为空")

    _, _, model = get_llm_config(db=db)
    delimiter_hint = ""
    if delimiters:
        delimiter_hint = f"- 优先在以下标点处切分：{'、'.join(delimiters)}"
    prompt = _SPLIT_PROMPT_TEMPLATE.format(text=text, delimiter_hint=delimiter_hint)

    response = call_llm_structured(
        [{"role": "user", "content": prompt}],
        schema=_SplitResponse,
        temperature=0.2,
        max_tokens=4096,
        db=db,
        timeout=30,
    )

    # Pydantic 已经把 emotion 限制在白名单内，无需再做枚举校验
    segments = [
        {"text": s.text.strip(), "reason": s.reason, "emotion": s.emotion}
        for s in response.segments
        if s.text.strip()
    ]
    if not segments:
        raise ValueError("LLM 返回了空的拆分结果")

    return SplitResult(segments=segments, model=model)


# ---------------------------------------------------------------------------
# ssml_annotate
# ---------------------------------------------------------------------------

@dataclass
class SSMLAnnotateResult:
    annotations: list[dict]   # [{"text", "ssml", "rationale"}]
    model: str | None


# 允许的 SSML 标签。其他标签会被剥除。
_SSML_ALLOWED_TAGS = {"speak", "break", "prosody", "emphasis"}

# 匹配 XML 标签（含属性）：<tag>, </tag>, <tag attr="x">, <tag/>
_TAG_RE = re.compile(r'<(/?)([a-zA-Z][a-zA-Z0-9]*)(\s[^>]*)?(/?)>')


def _strip_non_whitelist_tags(ssml: str) -> str:
    """删除所有不在白名单中的标签（保留其内部文字）。"""
    def repl(m: re.Match) -> str:
        tag_name = m.group(2).lower()
        return m.group(0) if tag_name in _SSML_ALLOWED_TAGS else ""
    return _TAG_RE.sub(repl, ssml)


def _ssml_to_plain(ssml: str) -> str:
    """剥掉所有 SSML 标签后剩下的纯文字（用于与原文做 diff）。"""
    return _TAG_RE.sub("", ssml)


class _SSMLAnnotation(BaseModel):
    text: str = Field(..., description="原文（必须与输入完全一致）")
    ssml: str = Field(..., description="带 SSML 标签的文本，必须用 <speak>...</speak> 包裹")
    rationale: str = Field(default="", description="本次标注的简短解释")


class _SSMLAnnotateResponse(BaseModel):
    annotations: list[_SSMLAnnotation]


_SSML_PROMPT_TEMPLATE = """你是 SSML 标注助手。请为下面的若干段中文文本添加 SSML 标签，
让语音合成更自然、有节奏。

要求：
- 严格保留原文一字不改，仅在合适位置插入标签
- 仅允许使用以下标签：<speak>, <break time="...ms"/>, <prosody rate/pitch/volume>, <emphasis level="...">
- 每段必须用 <speak>...</speak> 包裹
- 风格提示：{style_hint}
- 输出 JSON 对象，结构为 {{"annotations": [{{"text": "原文", "ssml": "<speak>...</speak>", "rationale": "简短解释"}}, ...]}}

待标注文本：
{numbered_texts}
"""


def ssml_annotate(texts: list[str], style_hint: str = "", db=None) -> SSMLAnnotateResult:
    """调 LLM 为每段加 SSML 标签。带白名单与原文一致性校验。"""
    if not texts:
        raise ValueError("texts 不能为空")

    _, _, model = get_llm_config(db=db)

    numbered = "\n".join(f"{i+1}. {t}" for i, t in enumerate(texts))
    prompt = _SSML_PROMPT_TEMPLATE.format(
        style_hint=style_hint or "（无）",
        numbered_texts=numbered,
    )

    response = call_llm_structured(
        [{"role": "user", "content": prompt}],
        schema=_SSMLAnnotateResponse,
        temperature=0.4,
        max_tokens=8192,
        db=db,
        timeout=60,
    )

    # LLM 可能漏返回某些段；按原文顺序对齐
    annotations: list[dict] = []
    parsed = response.annotations
    for i, original in enumerate(texts):
        item = parsed[i] if i < len(parsed) else None
        raw_ssml = (item.ssml if item else "").strip()
        rationale = item.rationale if item else ""

        if not raw_ssml:
            # LLM 没给 ssml，退化
            annotations.append({"text": original, "ssml": f"<speak>{original}</speak>", "rationale": rationale})
            continue

        # 1. 剥除非白名单标签
        cleaned = _strip_non_whitelist_tags(raw_ssml)
        # 2. diff 校验：剥所有标签后的纯文本必须 == 原文（忽略首尾空白）
        plain = _ssml_to_plain(cleaned).strip()
        if plain != original.strip():
            logger.warning(f"SSML annotate: 段{i+1} 文字与原文不一致，退化。plain={plain!r} original={original!r}")
            cleaned = f"<speak>{original}</speak>"
        # 3. 确保 <speak> 包裹
        if not cleaned.startswith("<speak"):
            cleaned = f"<speak>{cleaned}</speak>"

        annotations.append({"text": original, "ssml": cleaned, "rationale": rationale})

    return SSMLAnnotateResult(annotations=annotations, model=model)
