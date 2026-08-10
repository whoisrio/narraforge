"""Edge-TTS 语音合成服务
使用 Microsoft Edge 在线 TTS 服务，支持多种语言和音色

部署策略（settings.deploy_target）：
- local：使用 edge-tts 包（local-services extra，现有行为）。
- workers：按运行时能力选择（步骤 6A-1）：
  - 真 Cloudflare Workers（Pyodide，workers.fetch 可用）：内置手写 WS 客户端
    （edge_tts_ws_client + edge_tts_protocol，spike 验证，无 aiohttp 依赖）。
  - Render 等 CPython 部署（DEPLOY_TARGET=workers 但无 workers 模块）：
    回退 edge-tts 包（local-services extra 提供，惰性 import）。
  - 两者皆无：响亮 RuntimeError（部署/配置错误，不静默）。
edge_tts 包在 Pyodide workers 环境不存在，import 必须延迟到策略选择之后。
"""

import asyncio
import uuid
import time
import logging
from typing import Optional

from app.core.config import settings

# workers 环境没有 edge_tts 包（且 Pyodide 装不了 aiohttp），
# 只在 local 部署目标下做模块级 import，保留既有测试的 patch 点。
if settings.deploy_target != "workers":
    import edge_tts

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


def _workers_runtime_available() -> bool:
    """是否为真正的 Cloudflare Workers Python（Pyodide）运行时。

    Render 等 CPython 部署同样用 DEPLOY_TARGET=workers（同一组在线路由），
    但没有 workers 模块；以此区分 WS 客户端（Pyodide 专有）与 edge-tts 包回退。
    """
    try:
        import workers
    except ImportError:
        return False
    return hasattr(workers, "fetch")


def _edge_tts_package_available() -> bool:
    """edge-tts 包是否可用。workers 模式下包未做模块级 import，需惰性探测。"""
    if settings.deploy_target != "workers":
        return True  # 模块级 import 已成功，否则本模块根本加载不进来
    try:
        import edge_tts  # noqa: F401
    except ImportError:
        return False
    return True


def _import_edge_tts():
    """返回 edge_tts 模块。local 走模块级 import；workers 回退路径惰性 import。"""
    if settings.deploy_target != "workers":
        return edge_tts
    try:
        import edge_tts as pkg

        return pkg
    except ImportError as e:
        raise RuntimeError(
            "edge-tts 包未安装：workers（CPython 回退）路径需要 edge-tts 包，"
            "请安装 local-services extra（uv sync --extra local-services）"
        ) from e


def _select_synth_backend() -> str:
    """合成后端选择：'ws'（Pyodide WS 客户端）| 'package'（edge-tts 包）。

    workers 模式优先 WS 客户端（真 Workers 运行时）；无 workers 运行时
    （Render 等 CPython 部署）回退 edge-tts 包；两者皆无 → 响亮错误。
    """
    if settings.deploy_target != "workers":
        return "package"
    if _workers_runtime_available():
        return "ws"
    if _edge_tts_package_available():
        return "package"
    raise RuntimeError(
        "edge-tts 不可用：当前既非 Cloudflare Workers（Pyodide）运行时"
        "（workers.fetch 缺失），也未安装 edge-tts 包。"
        "CPython 部署（如 Render）请安装 local-services extra"
    )


async def _synthesize_with_package(text: str, voice: str, rate: str, volume: str) -> bytes:
    """edge-tts 包合成路径（local 与 workers-CPython 回退共用）。"""
    pkg = _import_edge_tts()
    communicate = pkg.Communicate(
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
    return audio_data


class EdgeTTSService:
    """Edge-TTS 服务 - 支持多种语言和音色"""

    _voices_cache: Optional[list[dict]] = None
    _voices_cache_time: float = 0
    _cache_ttl: float = 3600  # 1 hour

    def __init__(self, voices_transport=None):
        # 可注入的 httpx transport（workers 模式音色列表；测试用 MockTransport）
        self._voices_transport = voices_transport

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

        if settings.deploy_target == "workers":
            raw_voices = await self._list_voices_workers()
        else:
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

    async def _list_voices_workers(self) -> list[dict]:
        """workers 模式音色列表：voices/list REST 端点（httpx，与 edge-tts 7.x 同一 URL/参数）。"""
        import httpx

        from app.services import edge_tts_protocol as proto

        url = (
            f"https://{proto.BASE_URL}/voices/list"
            f"?trustedclienttoken={proto.TRUSTED_CLIENT_TOKEN}"
            f"&Sec-MS-GEC={proto.generate_sec_ms_gec()}"
            f"&Sec-MS-GEC-Version={proto.SEC_MS_GEC_VERSION}"
        )
        async with httpx.AsyncClient(transport=self._voices_transport, timeout=30) as client:
            resp = await client.get(url, headers=proto.WSS_HEADERS)
            resp.raise_for_status()
            return resp.json()

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
        max_retries: int = 3,
    ) -> tuple[bytes, str]:
        """使用 edge-tts 合成语音

        Args:
            text: 要合成的文本
            voice: 音色名 (如 "zh-CN-XiaoxiaoNeural")
            rate: 语速 (如 "+0%", "+50%", "-20%")
            volume: 音量 (如 "+0%", "+10%", "-10%")
            max_retries: 最大重试次数

        Returns:
            (audio_data, audio_format) 音频数据和格式
        """
        backend = _select_synth_backend()
        for attempt in range(max_retries):
            try:
                if backend == "ws":
                    # 真 Cloudflare Workers（Pyodide）：内置手写 WS 客户端
                    from app.services.edge_tts_ws_client import synthesize as ws_synthesize

                    audio_data = await ws_synthesize(
                        text=text, voice=voice, rate=rate, volume=volume
                    )
                else:
                    # local 或 workers-CPython（Render）回退：edge-tts 包
                    audio_data = await _synthesize_with_package(text, voice, rate, volume)

                if not audio_data:
                    raise RuntimeError("No audio received from edge-tts")

                return audio_data, "mp3"
            except Exception as e:
                if attempt < max_retries - 1:
                    logger.warning(f"Edge TTS attempt {attempt + 1} failed: {e}, retrying...")
                    await asyncio.sleep(1)
                else:
                    raise


# 全局服务实例
_edge_tts_service: Optional[EdgeTTSService] = None


def get_edge_tts_service() -> EdgeTTSService:
    """获取 Edge TTS 服务实例"""
    global _edge_tts_service
    if _edge_tts_service is None:
        _edge_tts_service = EdgeTTSService()
    return _edge_tts_service
