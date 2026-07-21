"""文本拆分与 SSML 标注服务。

四个能力：
- rule_split: 纯本地，按用户指定的标点切分
- llm_split: 调 LLM 按语义切分
- ssml_annotate: 调 LLM 为段落自动添加 SSML 标签
- markdown_detect: 扫描 markdown 找出所有 H1-H6 候选标题, 用户挑粒度
"""

import logging
import re
from dataclasses import dataclass, field
from typing import Literal

from pydantic import BaseModel, Field

from app.services.llm_client import call_llm_structured

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# markdown_detect (P2 v3+)
# ---------------------------------------------------------------------------

# 匹配 H1-H6 标题行: 行首 1-6 个 # 后接空格 + 标题
# 注意: 在 fenced code block 内的 # 不算
HEADING_RE = re.compile(r"^(#{1,6})\s+(.+?)\s*$")
# 中文 "第 N 章" 模式 (一二三四五六七八九十百千0-9 + 章), 允许中间有空格
CHINESE_CHAPTER_RE = re.compile(
    r"^第\s*[一二三四五六七八九十百千0-9]+\s*章"
)
# fenced code block 起止
FENCE_RE = re.compile(r"^```")


def markdown_detect(
    text: str,
    min_chars: int = 80,
    front_matter_mode: str = "prepend_to_first",
) -> dict:
    """扫描 markdown 找出所有 H1-H6 候选标题, 平铺章节列表.

    返回:
      {
        "doc_title": str | None,          # 来自 H1, 或 None
        "candidates": [                   # 全部 H1-H6 标题
          {"level": int, "raw": str, "title": str, "char_pos": int, "preview": str},
          ...
        ],
        "chapters": [                     # 默认推荐 (按 H2 + 短章合并)
          {"index": int, "title": str, "level": int, "start_char": int, "end_char": int, "char_count": int, "preview": str},
          ...
        ],
        "total_chars": int,
      }
    """
    if not text or not text.strip():
        return {"doc_title": None, "candidates": [], "chapters": [], "total_chars": 0}

    lines = text.splitlines(keepends=True)
    n = len(lines)
    line_offsets: list[int] = [0]
    for ln in lines:
        line_offsets.append(line_offsets[-1] + len(ln))

    # 找所有标题 (跳过 fenced code block 内部)
    candidates: list[dict] = []
    in_fence = False
    for i, line in enumerate(lines):
        stripped = line.rstrip("\n")
        if FENCE_RE.match(stripped):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        m = HEADING_RE.match(stripped)
        if m:
            level = len(m.group(1))
            raw = m.group(2).strip()
            candidates.append({
                "level": level,
                "raw": raw,
                "title": raw,
                "char_pos": line_offsets[i],
                "is_chinese_chapter": bool(CHINESE_CHAPTER_RE.match(raw)),
            })

    # doc_title = 第一个 H1
    doc_title: str | None = None
    filtered: list[dict] = []
    for c in candidates:
        if c["level"] == 1:
            # 第一个 H1 作 doc_title, 后续 H1 仍不进 candidates (H1 不当章节边界)
            if doc_title is None:
                doc_title = c["title"]
            continue
        filtered.append(c)

    # 给每个候选加 preview (后 200 字)
    for c in filtered:
        start = c["char_pos"]
        end_pos = next((x["char_pos"] for x in filtered if x["char_pos"] > start), len(text))
        preview = text[start:end_pos].strip()
        # 去掉标题行本身
        first_nl = preview.find("\n")
        if first_nl != -1:
            preview = preview[first_nl + 1:].strip()
        c["preview"] = preview[:200]

    # 默认推荐: 按 H2 切, 短章合并
    recommended = _build_chapters(
        text, filtered,
        min_chars=min_chars,
        front_matter_mode=front_matter_mode,
        default_level=2,
    )

    return {
        "doc_title": doc_title,
        "candidates": filtered,
        "chapters": recommended,
        "total_chars": len(text),
    }


def _build_chapters(
    text: str,
    candidates: list[dict],
    min_chars: int,
    front_matter_mode: str,
    default_level: int,
) -> list[dict]:
    """从候选构建 flat 章节列表.

    规则:
    1. 选 level=default_level 的候选作为边界
    2. 短于 min_chars 的章节合并到下一章
    3. front matter (首个标题前的内容) 按 mode 处理
    """
    boundaries = [c for c in candidates if c["level"] == default_level]
    if not boundaries:
        # fallback: 用所有候选
        boundaries = candidates
    if not boundaries:
        # 无任何标题: 整篇当 1 章
        return [{
            "index": 0,
            "title": "全文",
            "level": 0,
            "start_char": 0,
            "end_char": len(text),
            "char_count": len(text),
            "preview": text[:200],
        }]

    # 算每个 boundary 的 start_char / end_char
    raw_chapters: list[dict] = []
    for idx, c in enumerate(boundaries):
        start = c["char_pos"]
        end = boundaries[idx + 1]["char_pos"] if idx + 1 < len(boundaries) else len(text)
        raw_chapters.append({
            "title": c["title"],
            "level": c["level"],
            "start_char": start,
            "end_char": end,
            "char_count": end - start,
        })

    # front matter 处理
    first_start = raw_chapters[0]["start_char"]
    if first_start > 0:
        fm_text = text[:first_start].strip()
        if fm_text:
            if front_matter_mode == "prepend_to_first":
                raw_chapters[0]["start_char"] = 0
                raw_chapters[0]["char_count"] = raw_chapters[0]["end_char"]
                raw_chapters[0]["title"] = f"{raw_chapters[0]['title']} (含引言)"
            elif front_matter_mode == "own_chapter":
                raw_chapters.insert(0, {
                    "title": "引言",
                    "level": 0,
                    "start_char": 0,
                    "end_char": first_start,
                    "char_count": first_start,
                })
            # skip 模式: 直接扔掉

    # 短章合并: 短于 min_chars 的合并到下一章
    merged: list[dict] = []
    for ch in reversed(raw_chapters):  # 从后往前, 短章往后合
        if ch["char_count"] < min_chars and merged:
            # 合并到 merged[0] (它的下一章)
            merged[0]["start_char"] = ch["start_char"]
            merged[0]["char_count"] = merged[0]["end_char"] - ch["start_char"]
            merged[0]["title"] = ch["title"] + " · " + merged[0]["title"]
        else:
            merged.insert(0, ch)

    # 加 index + preview
    for i, ch in enumerate(merged):
        ch["index"] = i
        body = text[ch["start_char"]:ch["end_char"]]
        first_nl = body.find("\n")
        preview = body[first_nl + 1:].strip() if first_nl != -1 else body.strip()
        ch["preview"] = preview[:200]

    return merged


def markdown_split(
    text: str,
    levels: list[int],
    min_chars: int = 80,
    front_matter_mode: str = "prepend_to_first",
) -> list[dict]:
    """按用户指定的 levels 列表切分 (不只默认 H2).

    levels: 例如 [1, 2] 表示 H1 和 H2 都当章节边界. H1 仍作 doc_title (不当章节).
    """
    full = markdown_detect(text, min_chars=min_chars, front_matter_mode=front_matter_mode)
    if not full["candidates"]:
        return full["chapters"]

    # H1 不参与切分 (只作 doc_title). markdown_detect 已过滤掉 H1.
    # 但用户传 [1, 2] 时, 我们要保留 H2+ 当切分.
    filtered: list[dict] = []
    for c in full["candidates"]:
        if c["level"] in levels and c["level"] != 1:  # H1 排除
            filtered.append(c)

    if not filtered:
        # 所有候选都被排除 (例如只有 H1), 整篇当 1 章
        return full["chapters"]

    # 选最低 level 作主分割 (构建章节用)
    primary_level = min(c["level"] for c in filtered)

    return _build_chapters(
        text, filtered,
        min_chars=min_chars,
        front_matter_mode=front_matter_mode,
        default_level=primary_level,
    )


# ---------------------------------------------------------------------------
# rule_split
# ---------------------------------------------------------------------------

def rule_split(
    text: str,
    delimiters: list[str],
    min_len_to_merge: int = 5,
    next_max_len_to_merge: int = 15,
) -> list[str]:
    """按指定标点切分文本。保留标点在段尾。过滤空白段和纯标点段。

    合并规则（防止逗号密集时切出过多碎片段）：
    - 若某段长度 < ``min_len_to_merge`` 且下一段长度 < ``next_max_len_to_merge``，
      将下一段并入该段。贪心从左至右扫描，合并后若仍短继续吸并后续段。
    - 传入 ``min_len_to_merge <= 0`` 可关闭合并，保留原始细粒度切分。

    长度以段内字符数（Unicode codepoint 数，含末尾标点）计。
    """
    if not text or not text.strip():
        return []

    if not delimiters:
        stripped = text.strip()
        return [stripped] if stripped else []

    # 构造正则：在标点之后切分（保留标点在前段）
    escaped = [re.escape(d) for d in delimiters]
    pattern = re.compile(f"(?<=[{''.join(escaped)}])")
    parts = pattern.split(text)

    segments: list[str] = []
    for p in parts:
        s = p.strip()
        if not s:
            continue
        # 过滤纯标点段（仅由 delimiters 中的字符组成）
        if all(c in delimiters for c in s):
            continue
        segments.append(s)

    if min_len_to_merge <= 0 or not segments:
        return segments

    # 短段合并：当前段 < min_len_to_merge 且下一段 < next_max_len_to_merge → 合并
    merged: list[str] = []
    for seg in segments:
        if (
            merged
            and len(merged[-1]) < min_len_to_merge
            and len(seg) < next_max_len_to_merge
        ):
            merged[-1] = merged[-1] + seg
        else:
            merged.append(seg)
    return merged


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
- 每段控制在 10-20 字
- 在语气转折、停顿点、并列结构处切分
{delimiter_hint}
- 判断每段的感情色彩，从以下选项中选一个：happy(欣喜/积极)、sad(沉重/悲伤)、angry(愤怒/激烈)、calm(沉稳/平和)、neutral(中性/陈述)、excited(激昂/振奋)
- 输出 JSON 对象，结构为 {{"segments": [{{"text": "...", "reason": "切分理由", "emotion": "neutral"}}, ...]}}

文本：
{text}

示例说明:
假如输入为： 今天天气很好，但我们还是没能按时完成任务，这让我感到非常沮丧。
那么输出应该如下:
{{
    "segments": [
    {{      "text": "今天天气很好，",      "reason": "标点停顿点（逗号）",      "emotion": "happy"    }},
    {{      "text": "但我们还是没能按时完成任务，",      "reason": "语气转折（'但'）",      "emotion": "sad"    }},
    {{      "text": "这让我感到非常沮丧。",      "reason": "语义完整句+情感表达终点",      "emotion": "sad"    }}  ]
}}
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
