"""Edge-TTS 语音合成服务
使用 Microsoft Edge 在线 TTS 服务，支持多种语言和音色
"""

import asyncio
import uuid
import time
import logging
from typing import Optional

import edge_tts

from app.core.config import settings

logger = logging.getLogger(__name__)

# locale 前缀到语言显示名的映射
LOCALE_LANGUAGE_MAP = {
    "zh-CN": "Chinese",
    "zh-TW": "Chinese",
    "zh-HK": "Chinese",
    "en-US": "English",
    "en-GB": "English",
    "en-AU": "English",
    "en-CA": "English",
    "en-IN": "English",
    "ja-JP": "Japanese",
    "ko-KR": "Korean",
    "fr-FR": "French",
    "de-DE": "German",
    "es-ES": "Spanish",
    "pt-BR": "Portuguese",
    "ru-RU": "Russian",
    "it-IT": "Italian",
    "nl-NL": "Dutch",
    "pl-PL": "Polish",
    "tr-TR": "Turkish",
    "ar-SA": "Arabic",
    "th-TH": "Thai",
    "vi-VN": "Vietnamese",
    "id-ID": "Indonesian",
}


def _locale_to_language(locale: str) -> str:
    """将 locale (如 zh-CN) 转为语言显示名 (如 Chinese)"""
    return LOCALE_LANGUAGE_MAP.get(locale, locale.split("-")[0])


class EdgeTTSService:
    """Edge-TTS 服务 - 支持多种语言和音色"""

    _voices_cache: Optional[list[dict]] = None
    _voices_cache_time: float = 0
    _cache_ttl: float = 3600  # 1 hour

    async def list_voices(
        self,
        language: Optional[str] = None,
        gender: Optional[str] = None,
    ) -> list[dict]:
        """获取 edge-tts 支持的音色列表，支持按语言和性别筛选

        Args:
            language: 语言名 (如 "Chinese", "English")
            gender: 性别 ("Male" 或 "Female")

        Returns:
            音色列表，每个音色包含 name, short_name, display_name, gender, locale, language
        """
        voices = await self._get_all_voices()

        if language:
            voices = [v for v in voices if v["language"] == language]
        if gender:
            voices = [v for v in voices if v["gender"] == gender]

        return voices

    async def _get_all_voices(self) -> list[dict]:
        """获取所有音色，使用内存缓存"""
        now = time.time()
        if self._voices_cache is not None and (now - self._voices_cache_time) < self._cache_ttl:
            return self._voices_cache

        raw_voices = await edge_tts.list_voices()

        voices = []
        for v in raw_voices:
            short_name = v["ShortName"]
            locale = v["Locale"]
            gender = v["Gender"]

            # 从 ShortName 提取显示名（去掉语言前缀和 Neural 后缀）
            # e.g. "zh-CN-XiaoxiaoNeural" -> "Xiaoxiao"
            parts = short_name.split("-")
            display_name = parts[-1].replace("Neural", "").replace("V2", "").replace("V3", "")

            voices.append({
                "name": v["Name"],
                "short_name": short_name,
                "display_name": display_name,
                "gender": gender,
                "locale": locale,
                "language": _locale_to_language(locale),
            })

        self._voices_cache = voices
        self._voices_cache_time = now
        return voices

    async def get_available_languages(self) -> list[str]:
        """获取所有可用语言列表"""
        voices = await self._get_all_voices()
        languages = sorted(set(v["language"] for v in voices))
        return languages

    async def synthesize(
        self,
        text: str,
        voice: str,
        rate: str = "+0%",
        volume: str = "+0%",
    ) -> tuple[bytes, str]:
        """使用 edge-tts 合成语音

        Args:
            text: 要合成的文本
            voice: 音色名 (如 "zh-CN-XiaoxiaoNeural")
            rate: 语速 (如 "+0%", "+50%", "-20%")
            volume: 音量 (如 "+0%", "+10%", "-10%")

        Returns:
            (audio_data, audio_format) 音频数据和格式
        """
        communicate = edge_tts.Communicate(
            text=text,
            voice=voice,
            rate=rate,
            volume=volume,
            connect_timeout=10,
            receive_timeout=30,
        )

        audio_data = b""
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                audio_data += chunk["data"]

        if not audio_data:
            raise RuntimeError("No audio received from edge-tts")

        return audio_data, "mp3"


# 全局服务实例
_edge_tts_service: Optional[EdgeTTSService] = None


def get_edge_tts_service() -> EdgeTTSService:
    """获取 Edge TTS 服务实例"""
    global _edge_tts_service
    if _edge_tts_service is None:
        _edge_tts_service = EdgeTTSService()
    return _edge_tts_service
