"""
LLM 字幕服务 — 校准 + 双语翻译

支持可配置的 LLM 后端（从 .env 读取）：
- LLM_API_KEY / LLM_BASE_URL / LLM_MODEL
- 未配置时自动回退到 MiMo TTS 的 API 配置
- 自动适配 MiMo (api-key) 和 Qwen (Bearer) 认证方式
"""

import logging
import re
from dataclasses import dataclass
from typing import Literal

from pydantic import BaseModel, Field, field_validator

# Re-exports from llm_client (migrated 2026-06-06). Aliased to private names
# to keep all existing call sites in this file working unchanged.
from app.services.llm_client import (
    LLMValidationError,
    call_llm as _call_llm,
    call_llm_structured as _call_llm_structured,
    extract_json_array as _extract_json_array,
    get_llm_config as _get_llm_config,
)

logger = logging.getLogger(__name__)


@dataclass
class CorrectionSuggestion:
    """单条校准建议"""
    index: int           # SRT 序号
    original: str        # ASR 原始文本
    suggested: str       # 建议文本
    reason: str          # 修改原因（简短）
    confidence: str      # 置信度: high / medium / low


@dataclass
class CorrectionResult:
    """校准结果"""
    suggestions: list[CorrectionSuggestion]
    model: str | None


@dataclass
class BilingualSegment:
    """双语字幕片段"""
    index: int
    time_line: str
    original: str
    translated: str


@dataclass
class BilingualResult:
    """双语翻译结果"""
    segments: list[BilingualSegment]
    target_language: str
    model: str | None


Confidence = Literal["high", "medium", "low"]


class _CorrectionItem(BaseModel):
    """LLM 返回的单条校准建议（schema 用）。"""
    index: int
    original: str = ""
    suggested: str = ""
    reason: str = ""
    confidence: Confidence = "medium"

    @field_validator("confidence", mode="before")
    @classmethod
    def _normalize_confidence(cls, v):
        # confidence 可能是 string("high") 或 int(100)，统一为 string
        if isinstance(v, (int, float)):
            if v >= 80:
                return "high"
            if v >= 50:
                return "medium"
            return "low"
        if isinstance(v, str):
            low = v.strip().lower()
            if low in ("high", "medium", "low"):
                return low
        return "medium"


class _CorrectionResponse(BaseModel):
    suggestions: list[_CorrectionItem] = Field(default_factory=list)


class _TranslationItem(BaseModel):
    index: int
    translated: str = ""


class _TranslationResponse(BaseModel):
    segments: list[_TranslationItem] = Field(default_factory=list)


def _parse_srt_blocks(srt_content: str) -> list[dict]:
    """解析 SRT 内容为结构化块列表。"""
    blocks = []
    # SRT 格式: 序号 \n 时间行 \n 文本行(可能多行) \n 空行
    pattern = re.compile(
        r'(\d+)\s*\n'
        r'(\d{2}:\d{2}:\d{2},\d{3}\s*-->\s*\d{2}:\d{2}:\d{2},\d{3})\s*\n'
        r'((?:(?!\n\d+\n\d{2}:\d{2}).+\n?)*)',
        re.MULTILINE,
    )
    for m in pattern.finditer(srt_content):
        blocks.append({
            "index": int(m.group(1)),
            "time_line": m.group(2).strip(),
            "text": m.group(3).strip(),
        })
    return blocks


def _build_srt_block(index: int, time_line: str, text: str) -> str:
    return f"{index}\n{time_line}\n{text}\n"


# ---------------------------------------------------------------------------
# 本地预筛：找出字幕中与原始文稿不匹配的行
# ---------------------------------------------------------------------------
def _local_prefilter(
    blocks: list[dict], original_document: str, threshold: float = 0.6
) -> tuple[list[dict], list[dict]]:
    """本地比对字幕和原始文稿，分为「匹配行」和「疑似错误行」。

    算法：对每条字幕，在原始文稿中找最相似的片段，
    计算相似度。低于 threshold 的标记为疑似错误。

    Args:
        blocks: SRT 块列表 [{"index": int, "time_line": str, "text": str}]
        original_document: 原始文稿
        threshold: 相似度阈值（0-1），低于此值视为疑似错误

    Returns:
        (matched_blocks, suspect_blocks) — 匹配的和疑似错误的
    """
    import difflib

    # 预处理：提取文稿中的中文字符序列，用于快速查找
    doc_text = original_document

    matched = []
    suspects = []

    for block in blocks:
        text = block["text"]
        # 提取字幕中的中文字符（去掉标点和空格）
        cn_chars = re.findall(r'[\u4e00-\u9fff\u3400-\u4dbf]', text)
        if not cn_chars:
            # 非中文行（如纯英文/数字），直接标记为匹配
            matched.append(block)
            continue

        cn_text = ''.join(cn_chars)

        # 在文稿中找最佳匹配位置
        # 用 SequenceMatcher 计算相似度
        best_ratio = 0.0

        # 方法1：直接在文稿中搜索连续子串
        # 先尝试精确匹配字幕文本（去掉标点后）
        text_no_punct = re.sub(r'[，。；！？、,.!?：:（）()\s]', '', text)
        if text_no_punct in doc_text.replace(' ', ''):
            best_ratio = 1.0
        else:
            # 方法2：用滑动窗口在文稿中找最相似片段
            # 窗口大小 = 字幕长度的 0.5x ~ 2x
            text_len = len(cn_text)
            if text_len == 0:
                matched.append(block)
                continue

            # 提取文稿中所有中文字符
            doc_cn = re.findall(r'[\u4e00-\u9fff\u3400-\u4dbf]', doc_text)
            doc_cn_text = ''.join(doc_cn)

            if len(doc_cn_text) < text_len:
                # 文稿比字幕还短，直接比较
                sm = difflib.SequenceMatcher(None, cn_text, doc_cn_text)
                best_ratio = sm.ratio()
            else:
                # 滑动窗口找最佳匹配
                step = max(1, text_len // 4)
                for start in range(0, len(doc_cn_text) - text_len + 1, step):
                    window = doc_cn_text[start:start + text_len + text_len // 2]
                    sm = difflib.SequenceMatcher(None, cn_text, window)
                    ratio = sm.ratio()
                    if ratio > best_ratio:
                        best_ratio = ratio
                        if best_ratio >= 0.95:
                            break  # 足够好，不用继续

        block["_match_ratio"] = round(best_ratio, 3)
        if best_ratio >= threshold:
            matched.append(block)
        else:
            suspects.append(block)

    return matched, suspects


# ---------------------------------------------------------------------------
# 字幕校准（基于原始文档对比）
# ---------------------------------------------------------------------------
def correct_subtitles(
    srt_content: str,
    original_document: str,
    language: str = "zh",
    model: str | None = None,
    mode: str = "smart",
    db=None,
) -> CorrectionResult:
    """对比原始文档和 ASR 字幕，找出识别错误（错别字）并返回修改建议。

    两种模式：
    - "full": 全量 LLM，所有字幕都送给 LLM 分析
    - "smart": 本地预筛 + LLM 复验，先本地比对找出疑似错误行，
               只把疑似错误行送给 LLM，节省 token 和时间

    核心原则：
    - 只改错别字（同音字/近音字/漏字/多字），绝不改变内容意思
    - 原文说了什么，字幕就保持什么意思
    - 保持时间轴不变——只替换字幕文本中的错误字词
    """
    blocks = _parse_srt_blocks(srt_content)
    if not blocks:
        return CorrectionResult(suggestions=[], model=model)

    # ---------- smart 模式：本地预筛 ----------
    if mode == "smart":
        matched, suspects = _local_prefilter(blocks, original_document)
        logger.info(
            f"本地预筛: {len(blocks)}条字幕, "
            f"匹配{len(matched)}条, 疑似错误{len(suspects)}条"
        )
        if not suspects:
            # 全部匹配，无需调用 LLM
            return CorrectionResult(suggestions=[], model=model)
        # 只把疑似错误行送给 LLM
        llm_blocks = suspects
    else:
        llm_blocks = blocks

    # ---------- 构建 LLM 请求 ----------
    srt_lines = []
    for b in llm_blocks:
        srt_lines.append(f"[{b['index']}] {b['text']}")
    srt_blob = "\n".join(srt_lines)

    system_prompt = (
        "你是一位专业的字幕校对员。你的任务是：\n\n"
        "用户会给你两份文本：\n"
        "1. 【原始文稿】—— 正确的原始内容\n"
        "2. 【ASR 字幕】—— 语音识别自动生成的字幕（有序号）\n\n"
        "请逐条对比 ASR 字幕和原始文稿，找出 ASR 识别中的**错别字**。\n\n"
        "严格规则：\n"
        "- 只修 ASR 识别错误的字词（同音字、近音字、漏字、多字）\n"
        "- 绝对不能改变原文要表达的意思\n"
        "- 绝对不能添加、删除或重排内容\n"
        "- 如果 ASR 字幕的文字和原始文稿意思一致，只是措辞略有不同，不要修改\n"
        "- 只关注明显的识别错误\n\n"
        "输出 JSON 对象 {\"suggestions\": [...]}，每个 suggestion 包含：\n"
        '  "index": SRT序号(int)\n'
        '  "original": ASR原文（该条字幕的完整文本）\n'
        '  "suggested": 修改后的完整文本（只改错字，其余保持不变）\n'
        '  "reason": 错误说明（如"期中→期终，同音字错误"，15字以内）\n'
        '  "confidence": "high" / "medium" / "low"\n\n'
        "如果所有字幕都正确，返回 {\"suggestions\": []}。"
    )

    user_content = (
        f"【原始文稿】\n{original_document}\n\n"
        f"【ASR 字幕】\n{srt_blob}"
    )

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_content},
    ]

    try:
        response = _call_llm_structured(
            messages,
            schema=_CorrectionResponse,
            model=model,
            temperature=0.1,
            db=db,
        )
    except LLMValidationError as e:
        logger.warning(f"LLM 校准返回无法解析: {e}; last_raw[:300]={e.last_raw[:300]!r}")
        return CorrectionResult(suggestions=[], model=model)

    valid_indexes = {b["index"] for b in blocks}
    suggestions = []
    for item in response.suggestions:
        # 校验：suggested 和 original 必须不同
        if item.original == item.suggested:
            continue
        # 校验：index 必须在合法范围内
        if item.index not in valid_indexes:
            continue
        suggestions.append(CorrectionSuggestion(
            index=item.index,
            original=item.original,
            suggested=item.suggested,
            reason=item.reason,
            confidence=item.confidence,
        ))

    return CorrectionResult(suggestions=suggestions, model=model)


# ---------------------------------------------------------------------------
# 双语字幕翻译
# ---------------------------------------------------------------------------
def translate_subtitles(srt_content: str, target_language: str = "English",
                        source_language: str = "Chinese",
                        model: str | None = None, db=None) -> BilingualResult:
    """将 SRT 字幕翻译为目标语言，返回双语字幕结构。"""
    blocks = _parse_srt_blocks(srt_content)
    if not blocks:
        return BilingualResult(segments=[], target_language=target_language, model=model)

    # 批量翻译（每批最多 30 条，避免超长）
    batch_size = 30
    all_segments: list[BilingualSegment] = []

    for batch_start in range(0, len(blocks), batch_size):
        batch = blocks[batch_start:batch_start + batch_size]

        text_lines = []
        for b in batch:
            text_lines.append(f"[{b['index']}] {b['text']}")
        text_blob = "\n".join(text_lines)

        system_prompt = (
            f"你是一位专业的字幕翻译员。将以下 {source_language} 字幕翻译为 {target_language}。\n"
            "要求：\n"
            "1. 保持每条字幕的序号 [N] 对应关系\n"
            "2. 翻译自然流畅，适合字幕显示\n"
            "3. 每条翻译保持简洁，控制在合理长度\n\n"
            "输出 JSON 对象 {\"segments\": [...]}，每个 segment 包含：\n"
            '  "index": 序号(int)\n'
            '  "translated": 翻译后的文本'
        )

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": text_blob},
        ]

        try:
            response = _call_llm_structured(
                messages,
                schema=_TranslationResponse,
                model=model,
                db=db,
            )
            trans_map = {item.index: item.translated for item in response.segments}
        except LLMValidationError as e:
            logger.warning(
                f"翻译 LLM 返回无法解析: {e}; last_raw[:300]={e.last_raw[:300]!r}"
            )
            trans_map = {}

        for b in batch:
            translated = trans_map.get(b["index"]) or b["text"]
            all_segments.append(BilingualSegment(
                index=b["index"], time_line=b["time_line"],
                original=b["text"], translated=translated,
            ))

    return BilingualResult(
        segments=all_segments,
        target_language=target_language,
        model=model,
    )


def build_bilingual_srt(result: BilingualResult) -> str:
    """将双语翻译结果构建为标准 SRT 格式（原文 + 翻译）。"""
    lines = []
    for seg in result.segments:
        lines.append(str(seg.index))
        lines.append(seg.time_line)
        lines.append(seg.original)
        lines.append(seg.translated)
        lines.append("")
    return "\n".join(lines)
