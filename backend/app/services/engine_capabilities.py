"""引擎风格 tag 能力适配（风格 tag 引擎适配）。

注意：本模块与前端 ``frontend/src/services/styleTags.ts`` 互为镜像，
任何规则改动（标签形式、情绪映射、能力矩阵）必须两侧同步。
"""
from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass(frozen=True)
class EngineCapability:
    """单个引擎对风格控制手段的支持情况。"""

    inline_tags: bool        # 文本内联 [tag] 形式
    leading_style_tag: bool  # 文本开头 (风格) 标签
    instruction: bool        # 独立 instruction 参数


ENGINE_CAPABILITIES: dict[str, EngineCapability] = {
    "mimo_tts": EngineCapability(inline_tags=False, leading_style_tag=True, instruction=True),
    "voxcpm": EngineCapability(inline_tags=True, leading_style_tag=True, instruction=True),
    "cosyvoice": EngineCapability(inline_tags=False, leading_style_tag=False, instruction=True),
    "edge_tts": EngineCapability(inline_tags=False, leading_style_tag=False, instruction=False),
}

# voxcpm 按合成 mode 细分能力：ultimate 高保真克隆不支持任何 tag/style
VOXCPM_MODE_CAPS: dict[str, EngineCapability] = {
    "clone": EngineCapability(inline_tags=True, leading_style_tag=True, instruction=True),
    "design": EngineCapability(inline_tags=True, leading_style_tag=True, instruction=True),
    "ultimate": EngineCapability(inline_tags=False, leading_style_tag=False, instruction=False),
}

# 历史/别名 mode 归一化
_VOXCPM_MODE_ALIAS: dict[str, str] = {
    "tts": "design",
    "tts_design": "design",
}

_NO_CAPS = EngineCapability(inline_tags=False, leading_style_tag=False, instruction=False)

# 段落 emotion -> 开头风格标签（neutral 无标签）
EMOTION_LEADING_TAG: dict[str, str] = {
    "happy": "开心",
    "sad": "悲伤",
    "angry": "愤怒",
    "calm": "平静",
    "excited": "兴奋",
}

_INLINE_TAG_RE = re.compile(r"\[[^\[\]]*\]")
_LEADING_TAG_RE = re.compile(r"^\s*[\(（][^\)）]*[\)）]\s*")


def voxcpm_supports(mode: str | None, feature: str) -> bool:
    """voxcpm 指定 mode 是否支持某能力（inline_tags / leading_style_tag / instruction）。

    未知 mode 按全支持处理（仅 ultimate 受限）。
    """
    key = _VOXCPM_MODE_ALIAS.get(mode or "", mode or "")
    caps = VOXCPM_MODE_CAPS.get(key, VOXCPM_MODE_CAPS["clone"])
    return bool(getattr(caps, feature))


def _caps_for(engine: str, voxcpm_mode: str | None = None) -> EngineCapability:
    if engine == "voxcpm":
        key = _VOXCPM_MODE_ALIAS.get(voxcpm_mode or "", voxcpm_mode or "")
        return VOXCPM_MODE_CAPS.get(key, VOXCPM_MODE_CAPS["clone"])
    return ENGINE_CAPABILITIES.get(engine, _NO_CAPS)


def strip_inline_tags(text: str) -> str:
    """移除 ``[...]`` 形式的内联 tag，并清理多余空白。"""
    if not text:
        return ""
    cleaned = _INLINE_TAG_RE.sub("", text)
    cleaned = re.sub(r"[ \t]{2,}", " ", cleaned)
    cleaned = re.sub(r" +(?=[，。！？；：、,.!?;:])", "", cleaned)
    return cleaned.strip()


def strip_leading_style_tag(text: str) -> str:
    """移除文本开头的 ``(…)`` 或 ``（…）`` 风格标签。"""
    if not text:
        return ""
    return _LEADING_TAG_RE.sub("", text, count=1)


def apply_leading_tag(
    text: str,
    emotion: str | None = None,
    style: str | None = None,
) -> str:
    """在文本开头加 ``(情绪,风格)`` 标签（同一对半角括号，"," 拼接，emotion 在前）。

    emotion 经 EMOTION_LEADING_TAG 映射（neutral/未知情绪无标签）；
    两者都为空时原样返回；已有开头标签时先 strip 再加（幂等）。
    """
    parts: list[str] = []
    emotion_tag = EMOTION_LEADING_TAG.get((emotion or "").strip())
    if emotion_tag:
        parts.append(emotion_tag)
    if style and style.strip():
        parts.append(style.strip())
    if not parts:
        return text
    body = strip_leading_style_tag(text)
    return f"({','.join(parts)}){body}"


def prepare_text_for_engine(
    text: str,
    *,
    engine: str,
    emotion: str | None = None,
    style: str | None = None,
    voxcpm_mode: str | None = None,
    mute_tags: bool = False,
) -> str:
    """按引擎能力清洗/标注待合成文本。

    规则：
    - ``mute_tags`` 或引擎不支持 inline → strip_inline_tags；
    - 引擎支持 leading 且未 mute → apply_leading_tag；
    - 其余情况（不支持 leading 或 mute）→ strip_leading_style_tag。
    即：不支持任何 tag 的引擎会得到完全无 tag 的纯文本。
    """
    caps = _caps_for(engine, voxcpm_mode)
    out = text or ""
    if mute_tags or not caps.inline_tags:
        out = strip_inline_tags(out)
    if caps.leading_style_tag and not mute_tags:
        out = apply_leading_tag(out, emotion=emotion, style=style)
    else:
        out = strip_leading_style_tag(out)
    return out
