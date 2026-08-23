"""
IndexTTS sidecar HTTP 客户端服务

IndexTTS-2.5 以独立进程（sidecar）运行在本机，backend 通过 HTTP 调用：
- GET  /status     — 模型加载状态与显存信息
- POST /load       — 加载模型
- POST /unload     — 释放显存
- POST /synthesize — TTS 合成（返回 audio/wav 字节流）

sidecar 启动方式见 backend/scripts/indextts_sidecar_server.py。
本模块只依赖 httpx / 标准库，严禁 import torch，保持 workers 模式 import 安全。
"""

import logging
from typing import Any, Dict, Optional

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)


class IndexTTSServiceError(RuntimeError):
    """IndexTTS sidecar 调用失败（连接失败或 sidecar 返回的 HTTP 错误）。"""


class IndexTTSService:
    """IndexTTS sidecar 服务封装（httpx 异步客户端）"""

    def __init__(
        self,
        base_url: Optional[str] = None,
        timeout: Optional[float] = None,
        transport: Optional[httpx.BaseTransport] = None,
    ):
        self.base_url = (base_url or settings.indextts_sidecar_url).rstrip("/")
        self.timeout = timeout or settings.indextts_timeout_sec
        # transport 可注入，便于测试用 httpx.MockTransport 打桩（仿 mimo_tts_service）
        self._transport = transport

    def _client(self) -> httpx.AsyncClient:
        kwargs: Dict[str, Any] = {}
        if self._transport is not None:
            kwargs["transport"] = self._transport
        return httpx.AsyncClient(
            base_url=self.base_url, timeout=self.timeout, **kwargs
        )

    async def _request(self, method: str, path: str, **kwargs) -> httpx.Response:
        """发起请求；连接失败抛出带中文提示的异常，HTTP 错误透传 sidecar detail。"""
        try:
            async with self._client() as client:
                resp = await client.request(method, path, **kwargs)
        except (httpx.ConnectError, httpx.ConnectTimeout) as e:
            raise IndexTTSServiceError(
                "IndexTTS sidecar 未启动，请先运行 sidecar 服务"
            ) from e
        except httpx.TimeoutException as e:
            raise IndexTTSServiceError(f"IndexTTS sidecar 请求超时: {e}") from e
        except httpx.HTTPError as e:
            raise IndexTTSServiceError(f"IndexTTS sidecar 请求失败: {e}") from e

        if resp.status_code >= 400:
            detail: Any = resp.text
            try:
                detail = resp.json().get("detail", detail)
            except Exception:
                pass
            raise IndexTTSServiceError(
                f"IndexTTS sidecar 错误 (HTTP {resp.status_code}): {detail}"
            )
        return resp

    async def status(self) -> Dict[str, Any]:
        """获取 sidecar 模型状态（loaded/device/vram_used_mb 等）"""
        resp = await self._request("GET", "/status")
        return resp.json()

    async def load(self) -> Dict[str, Any]:
        """加载模型到 GPU"""
        resp = await self._request("POST", "/load")
        return resp.json()

    async def unload(self) -> Dict[str, Any]:
        """释放 GPU 显存"""
        resp = await self._request("POST", "/unload")
        return resp.json()

    async def synthesize(
        self,
        text: str,
        lang: str,
        prompt_wav_path: str,
        emo_vector: Optional[list[float]] = None,
        emo_alpha: float = 1.0,
        duration_factor: float = 1.0,
    ) -> bytes:
        """
        TTS 合成，返回 WAV 音频字节。

        Args:
            text: 待合成文本
            lang: 语言（ZH/EN/JA/ES/AR）
            prompt_wav_path: 克隆参考音频路径（sidecar 本机路径）
            emo_vector: 8 维情绪向量 [happy, angry, sad, afraid, disgusted,
                melancholic, surprised, calm]，None 表示默认情绪
            emo_alpha: 情绪强度 0-1
            duration_factor: 时长因子 0.5-2.0
        """
        body = {
            "text": text,
            "lang": lang,
            "prompt_wav_path": prompt_wav_path,
            "emo_vector": emo_vector,
            "emo_alpha": emo_alpha,
            "duration_factor": duration_factor,
        }
        resp = await self._request("POST", "/synthesize", json=body)
        return resp.content


# ------------------------------------------------------------------
# 全局单例
# ------------------------------------------------------------------

_service: Optional[IndexTTSService] = None


def get_indextts_service() -> IndexTTSService:
    """获取 IndexTTS 服务单例"""
    global _service
    if _service is None:
        _service = IndexTTSService()
    return _service
