"""TTS 语音核对（ASR 回读验收）比对服务。

设计文档：docs/superpowers/specs/2026-10-15-tts-asr-verify-design.md

归一化规则（两侧文本都做，顺序固定）：
1. 全角转半角（ＮＡＳＡ → NASA，，→ ,）
2. 去所有空白
3. 去中英文标点（数字间的小数点除外——第 5 步需要它识别小数读法）
4. 小写化
5. 阿拉伯数字转中文读法（整数和小数；千分位逗号在第 3 步已消失，无额外处理）

已知边界（不遮掩，靠阈值 + 人工 diff 兜底）：
- 英文音色读数字是英文单词（three point one four），v1 不做英文数字归一化；
- 年份/电话号码等「逐位读」场景与标准基数读法不同，相似度会偏低。

比对逻辑全项目唯一实现：前端只做编排和呈现，不重复实现归一化。
"""
from __future__ import annotations

import difflib
import re
import unicodedata

DEFAULT_THRESHOLD = 0.8

# 数字段：整数或「整数.小数」。小数点在第 3 步被保护，只有两侧都是数字才保留。
_NUMBER_RE = re.compile(r"\d+(?:\.\d+)?")

_CN_DIGITS = "零一二三四五六七八九"
_CN_UNITS = ("", "十", "百", "千")
# 按每 4 位一组的大单位：1e4 万 / 1e8 亿 / 1e12 万亿（覆盖到 1e16-1，足够）
_CN_BIG_UNITS = ("", "万", "亿", "万亿", "亿亿")


def _fullwidth_to_halfwidth(text: str) -> str:
    """全角 ASCII 区（FF01-FF5E）转半角，全角空格（U+3000）转半角空格。"""
    out = []
    for ch in text:
        code = ord(ch)
        if code == 0x3000:
            out.append(" ")
        elif 0xFF01 <= code <= 0xFF5E:
            out.append(chr(code - 0xFEE0))
        else:
            out.append(ch)
    return "".join(out)


def _strip_punctuation(text: str) -> str:
    """移除 Unicode 标点（category P*），保留数字间的小数点。"""
    out = []
    for i, ch in enumerate(text):
        if unicodedata.category(ch).startswith("P"):
            if (
                ch == "."
                and 0 < i < len(text) - 1
                and text[i - 1].isdigit()
                and text[i + 1].isdigit()
            ):
                out.append(ch)  # 小数点：保留给数字读法步骤
            continue
        out.append(ch)
    return "".join(out)


def _four_digit_to_chinese(n: int) -> str:
    """0 < n < 10000 的中文读法（处理组内零，10-19 读「十X」不读「一十X」）。"""
    result: list[str] = []
    zero_pending = False
    started = False
    for pos in (3, 2, 1, 0):
        d = (n // (10**pos)) % 10
        if d == 0:
            if started:
                zero_pending = True
            continue
        if zero_pending and started:
            result.append("零")
        zero_pending = False
        result.append(_CN_DIGITS[d] + _CN_UNITS[pos])
        started = True
    s = "".join(result)
    if s.startswith("一十"):
        s = s[1:]
    return s


def _int_to_chinese(n: int) -> str:
    """非负整数的标准基数读法（万/亿分组，组间断零）。"""
    if n == 0:
        return "零"
    groups: list[int] = []
    while n > 0:
        groups.append(n % 10000)
        n //= 10000
    ordered = list(reversed(groups))  # 高 → 低
    pieces: list[str] = []
    need_zero = False
    for idx, g in enumerate(ordered):
        if g == 0:
            need_zero = bool(pieces)
            continue
        unit_idx = len(ordered) - 1 - idx  # 大单位从低位组起算：''/万/亿…
        text = _four_digit_to_chinese(g)
        if pieces and (need_zero or g < 1000):
            text = "零" + text
        unit = _CN_BIG_UNITS[unit_idx] if unit_idx < len(_CN_BIG_UNITS) else ""
        pieces.append(text + unit)
        need_zero = False
    return "".join(pieces)


def _number_to_chinese(num: str) -> str:
    """一个数字段（\\d+(?:\\.\\d+)?）的中文读法。小数部分逐位读。"""
    if "." in num:
        int_part, frac_part = num.split(".", 1)
        digits = _int_to_chinese(int(int_part)) if int_part else "零"
        frac = "".join(_CN_DIGITS[int(d)] for d in frac_part)
        return f"{digits}点{frac}"
    return _int_to_chinese(int(num))


def normalize_for_compare(text: str) -> str:
    """归一化：全角转半角 → 去空白 → 去标点（保数字间小数点）→ 小写 → 数字转读法。"""
    if not text:
        return ""
    out = _fullwidth_to_halfwidth(text)
    out = re.sub(r"\s+", "", out)
    out = _strip_punctuation(out)
    out = out.lower()
    out = _NUMBER_RE.sub(lambda m: _number_to_chinese(m.group(0)), out)
    return out


def similarity_ratio(a: str, b: str) -> float:
    """归一化文本相似度（difflib SequenceMatcher ratio，0.0-1.0）。"""
    return difflib.SequenceMatcher(None, a, b).ratio()


def build_diff(baseline: str, asr: str) -> list[dict[str, str]]:
    """归一化文本的 diff，op 取 difflib opcodes 语义：equal/replace/delete/insert。

    保证各 op 的 baseline/asr 拼接分别还原完整归一化文本。
    """
    ops: list[dict[str, str]] = []
    for op, i1, i2, j1, j2 in difflib.SequenceMatcher(None, baseline, asr).get_opcodes():
        ops.append({"op": op, "baseline": baseline[i1:i2], "asr": asr[j1:j2]})
    return ops


def verify_texts(
    baseline_text: str,
    asr_text: str,
    threshold: float = DEFAULT_THRESHOLD,
) -> dict:
    """比对基准文本与 ASR 回读文本，返回结构化结果（不落库）。

    Returns:
        {normalized_baseline, normalized_asr, similarity, match, diff}
    """
    normalized_baseline = normalize_for_compare(baseline_text)
    normalized_asr = normalize_for_compare(asr_text)
    similarity = similarity_ratio(normalized_baseline, normalized_asr)
    return {
        "normalized_baseline": normalized_baseline,
        "normalized_asr": normalized_asr,
        "similarity": similarity,
        "match": similarity >= threshold,
        "diff": build_diff(normalized_baseline, normalized_asr),
    }
