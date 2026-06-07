"""
LLM 字幕服务 — 校准 + 双语翻译

支持可配置的 LLM 后端（从 .env 读取）：
- LLM_API_KEY / LLM_BASE_URL / LLM_MODEL
- 未配置时自动回退到 MiMo TTS 的 API 配置
- 自动适配 MiMo (api-key) 和 Qwen (Bearer) 认证方式
"""

import json
import logging
import re
import urllib.request
import urllib.error
import ssl
from dataclasses import dataclass

from app.core.config import settings

logger = logging.getLogger(__name__)


def _extract_json_array(raw: str) -> str | None:
    """从 LLM 返回中提取 JSON 数组字符串。

    兼容：
    - 纯 JSON: [{"index": 1, ...}]
    - markdown 代码块: ```json\n[...]\n```
    - 前后带杂文: 这是结果：[...] 希望对你有帮助
    - reasoning 模型可能在 content 里带思考过程
    """
    if not raw or not raw.strip():
        return None

    text = raw.strip()

    # 1. 尝试从 markdown 代码块提取
    md_match = re.search(r'```(?:json)?\s*(\[.*?\])\s*```', text, re.DOTALL)
    if md_match:
        return md_match.group(1)

    # 2. 提取最外层 [...]（贪婪匹配最长的）
    arr_match = re.search(r'\[.*\]', text, re.DOTALL)
    if arr_match:
        candidate = arr_match.group()
        # 验证是合法 JSON
        try:
            parsed = json.loads(candidate)
            if isinstance(parsed, list):
                return candidate
        except json.JSONDecodeError:
            pass

    # 3. 全文尝试直接解析
    try:
        parsed = json.loads(text)
        if isinstance(parsed, list):
            return text
    except json.JSONDecodeError:
        pass

    return None


def _get_llm_config(db=None) -> tuple[str, str, str]:
    """返回 (api_key, base_url, model)，界面配置优先，LLM_ 未配置时回退到 MIMO_。

    当传入 db (Session) 时，优先从界面配置读取；
    未传入 db 或界面未配置时，回退到 .env 默认值。
    """
    # 基础值：从 .env settings
    api_key = settings.llm_api_key or settings.mimo_api_key
    base_url = (settings.llm_base_url or settings.mimo_base_url).rstrip("/")
    model = settings.llm_model

    # 界面配置优先
    if db is not None:
        try:
            from app.core.model_config_service import get_effective_config
            config = get_effective_config(db, "llm")
            # LLM 的 api_key 有 fallback_settings 到 mimo_api_key，
            # get_effective_config 已处理了 fallback，无需再手动 fallback
            api_key = config.get("api_key") or api_key
            base_url = (config.get("base_url") or base_url).rstrip("/")
            model = config.get("model") or model
        except Exception:
            pass  # 降级到 settings

    if not api_key:
        raise ValueError(
            "LLM API Key 未配置。请在界面或 .env 中设置 LLM_API_KEY 或 MIMO_API_KEY"
        )
    return api_key, base_url, model


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


def _call_llm(messages: list[dict], model: str | None = None,
              temperature: float = 0.3, max_tokens: int = 8192, db=None) -> str:
    """调用 LLM Chat API 并返回 assistant 消息内容。

    自动适配 MiMo (api-key header) 和 Qwen/OpenAI (Bearer) 认证。
    当传入 db 时，优先从界面配置读取连接参数。
    """
    api_key, base_url, default_model = _get_llm_config(db=db)
    model = model or default_model

    chat_url = f"{base_url}/chat/completions"

    payload = json.dumps({
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }).encode("utf-8")

    # 根据 base_url 判断认证方式
    if "xiaomimimo" in base_url:
        headers = {"api-key": api_key, "Content-Type": "application/json"}
    else:
        headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}

    req = urllib.request.Request(chat_url, data=payload, headers=headers)
    ctx = ssl.create_default_context()

    logger.info(f"LLM 调用: {model} @ {base_url}")
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=300) as resp:
            result = json.loads(resp.read().decode("utf-8"))
        msg = result["choices"][0]["message"]
        content = msg.get("content") or ""
        reasoning = msg.get("reasoning_content") or ""
        usage = result.get("usage", {})

        if not content.strip():
            logger.warning(
                f"LLM 返回空 content。usage={usage}, "
                f"reasoning_len={len(reasoning)}, finish={result['choices'][0].get('finish_reason')}"
            )
            # 如果有 reasoning 但无 content，说明 token 耗尽
            if reasoning:
                raise RuntimeError(
                    f"模型推理耗尽 token（reasoning={usage.get('completion_tokens_details', {}).get('reasoning_tokens', '?')}），"
                    f"未产生输出。请减少字幕条数或缩短原始文稿。"
                )
        return content
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        logger.error(f"LLM API error {e.code}: {body}")
        raise RuntimeError(f"LLM API 调用失败 ({e.code}): {body[:200]}")
    except Exception as e:
        logger.error(f"LLM API 异常: {e}")
        raise


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
        "输出格式：JSON 数组，每个元素：\n"
        '  "index": SRT序号(int)\n'
        '  "original": ASR原文（该条字幕的完整文本）\n'
        '  "suggested": 修改后的完整文本（只改错字，其余保持不变）\n'
        '  "reason": 错误说明（如"期中→期终，同音字错误"，15字以内）\n'
        '  "confidence": "high"/"medium"/"low"\n\n'
        "如果所有字幕都正确，返回空数组 []。\n"
        "只返回 JSON 数组，不要其他文字。"
    )

    user_content = (
        f"【原始文稿】\n{original_document}\n\n"
        f"【ASR 字幕】\n{srt_blob}"
    )

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_content},
    ]

    raw = _call_llm(messages, model=model, temperature=0.1, db=db)
    # 提取 JSON：兼容 markdown 代码块、前后杂文
    json_str = _extract_json_array(raw)
    if not json_str:
        logger.warning(f"LLM 返回非 JSON 内容 ({len(raw)}字): {raw[:300]}")
        return CorrectionResult(suggestions=[], model=model)

    try:
        items = json.loads(json_str)
    except json.JSONDecodeError:
        logger.warning(f"LLM 返回 JSON 解析失败: {json_str[:300]}")
        return CorrectionResult(suggestions=[], model=model)

    suggestions = []
    for item in items:
        idx = item.get("index", 0)
        # 校验：suggested 和 original 必须不同
        orig = item.get("original", "")
        sugg = item.get("suggested", "")
        if orig == sugg:
            continue
        # 校验：index 必须在合法范围内
        if not any(b["index"] == idx for b in blocks):
            continue
        # confidence 可能是 string("high") 或 int(100)，统一为 string
        raw_conf = item.get("confidence", "medium")
        if isinstance(raw_conf, (int, float)):
            if raw_conf >= 80:
                conf = "high"
            elif raw_conf >= 50:
                conf = "medium"
            else:
                conf = "low"
        else:
            conf = str(raw_conf).lower()
        suggestions.append(CorrectionSuggestion(
            index=idx,
            original=orig,
            suggested=sugg,
            reason=item.get("reason", ""),
            confidence=conf,
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
            "输出 JSON 数组，每个元素：\n"
            '  "index": 序号(int)\n'
            '  "translated": 翻译后的文本\n\n'
            "只返回 JSON。"
        )

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": text_blob},
        ]

        raw = _call_llm(messages, model=model, db=db)
        json_str = _extract_json_array(raw)
        if not json_str:
            logger.warning(f"翻译 LLM 返回非 JSON ({len(raw)}字): {raw[:300]}")
            # fallback: 填充原文
            for b in batch:
                all_segments.append(BilingualSegment(
                    index=b["index"], time_line=b["time_line"],
                    original=b["text"], translated=b["text"],
                ))
            continue

        try:
            trans_items = json.loads(json_str)
        except json.JSONDecodeError:
            for b in batch:
                all_segments.append(BilingualSegment(
                    index=b["index"], time_line=b["time_line"],
                    original=b["text"], translated=b["text"],
                ))
            continue

        trans_map = {item["index"]: item["translated"] for item in trans_items}
        for b in batch:
            translated = trans_map.get(b["index"], b["text"])
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
