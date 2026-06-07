"""
MiMo-V2.5-TTS 系列 语音合成服务

支持的三个模型：
1. mimo-v2.5-tts           - 预置音色语音合成
2. mimo-v2.5-tts-voicedesign - 文本描述定制音色
3. mimo-v2.5-tts-voiceclone  - 音频样本复刻音色

API 兼容 OpenAI Chat Completions 格式，通过 audio 参数控制音色和输出格式。
"""

import base64
import json
import logging
import os
import asyncio
import urllib.request
import urllib.error
from typing import Optional
from pathlib import Path

from app.core.config import settings

logger = logging.getLogger(__name__)

# MiMo TTS 预置音色列表
MIMO_PRESET_VOICES = [
    {"voice_id": "mimo_default", "name": "MiMo-默认", "language": "中英", "gender": "-", "description": "默认音色，中国集群为冰糖，其他集群为Mia"},
    {"voice_id": "冰糖", "name": "冰糖", "language": "中文", "gender": "女性", "description": "中文女声"},
    {"voice_id": "茉莉", "name": "茉莉", "language": "中文", "gender": "女性", "description": "中文女声"},
    {"voice_id": "苏打", "name": "苏打", "language": "中文", "gender": "男性", "description": "中文男声"},
    {"voice_id": "白桦", "name": "白桦", "language": "中文", "gender": "男性", "description": "中文男声"},
    {"voice_id": "Mia", "name": "Mia", "language": "英文", "gender": "女性", "description": "英文女声"},
    {"voice_id": "Chloe", "name": "Chloe", "language": "英文", "gender": "女性", "description": "英文女声"},
    {"voice_id": "Milo", "name": "Milo", "language": "英文", "gender": "男性", "description": "英文男声"},
    {"voice_id": "Dean", "name": "Dean", "language": "英文", "gender": "男性", "description": "英文男声"},
]


class MiMoTTSService:
    """MiMo-V2.5-TTS 语音合成服务"""

    def __init__(self, api_key: str, base_url: str = "https://api.xiaomimimo.com/v1"):
        if not api_key:
            raise ValueError("MiMo API key is required")
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")

    def _get_headers(self) -> dict:
        """返回请求头（MiMo 使用 api-key 而非 Authorization Bearer）"""
        return {
            "api-key": self.api_key,
            "Content-Type": "application/json",
        }

    # ------------------------------------------------------------------
    # 公开异步入口
    # ------------------------------------------------------------------

    async def synthesize_preset(
        self,
        text: str,
        voice: str = "冰糖",
        instruction: str = "",
        format: str = "wav",
    ) -> bytes:
        """
        使用预置音色进行语音合成（mimo-v2.5-tts）

        Parameters:
            text: 待合成的文本
            voice: 预置音色 ID（如 冰糖、Mia、Chloe 等）
            instruction: 可选的风格指令（放在 user 消息中）
            format: 输出格式 wav / mp3 / pcm16

        Returns:
            音频原始字节
        """
        messages = []
        if instruction:
            messages.append({"role": "user", "content": instruction})
        else:
            messages.append({"role": "user", "content": ""})

        messages.append({"role": "assistant", "content": text})

        audio_params = {"format": format, "voice": voice}

        return await asyncio.get_event_loop().run_in_executor(
            None,
            self._call_api_sync,
            "mimo-v2.5-tts",
            messages,
            audio_params,
        )

    async def synthesize_voice_design(
        self,
        text: str,
        voice_description: str,
        optimize_text_preview: bool = True,
        format: str = "wav",
    ) -> bytes:
        """
        使用文本描述设计音色进行语音合成（mimo-v2.5-tts-voicedesign）

        Parameters:
            text: 待合成的文本（放在 assistant 消息中，如果 optimize_text_preview=True 可省略）
            voice_description: 音色描述文本（放在 user 消息中）
            optimize_text_preview: 是否智能润色目标播报文本
            format: 输出格式

        Returns:
            音频原始字节
        """
        messages = [{"role": "user", "content": voice_description}]

        if text:
            messages.append({"role": "assistant", "content": text})

        audio_params = {
            "format": format,
            "optimize_text_preview": optimize_text_preview,
        }

        return await asyncio.get_event_loop().run_in_executor(
            None,
            self._call_api_sync,
            "mimo-v2.5-tts-voicedesign",
            messages,
            audio_params,
        )

    async def synthesize_voice_clone(
        self,
        text: str,
        audio_base64: str,
        mime_type: str = "audio/mpeg",
        instruction: str = "",
        format: str = "wav",
    ) -> bytes:
        """
        使用音频样本复刻音色进行语音合成（mimo-v2.5-tts-voiceclone）

        Parameters:
            text: 待合成的文本
            audio_base64: 音频文件的 Base64 编码字符串（不含前缀）
            mime_type: 音频 MIME 类型 audio/mpeg 或 audio/wav
            instruction: 可选的风格指令
            format: 输出格式

        Returns:
            音频原始字节
        """
        messages = []
        if instruction:
            messages.append({"role": "user", "content": instruction})
        else:
            messages.append({"role": "user", "content": ""})

        messages.append({"role": "assistant", "content": text})

        voice_uri = f"data:{mime_type};base64,{audio_base64}"
        audio_params = {"format": format, "voice": voice_uri}

        return await asyncio.get_event_loop().run_in_executor(
            None,
            self._call_api_sync,
            "mimo-v2.5-tts-voiceclone",
            messages,
            audio_params,
        )

    async def clone_from_file(
        self,
        text: str,
        audio_path: str,
        instruction: str = "",
        format: str = "wav",
    ) -> bytes:
        """
        便捷方法：从本地音频文件进行音色复刻

        Parameters:
            text: 待合成的文本
            audio_path: 本地音频文件路径（支持 mp3 / wav）
            instruction: 可选的风格指令
            format: 输出格式

        Returns:
            音频原始字节
        """
        with open(audio_path, "rb") as f:
            audio_bytes = f.read()

        # 检查文件大小（Base64 编码后不超过 10MB，即原始文件约 7.5MB）
        import sys
        estimated_b64_size = len(audio_bytes) * 4 / 3
        if estimated_b64_size > 10 * 1024 * 1024:
            raise ValueError("音频文件太大，Base64 编码后不能超过 10MB")

        audio_base64 = base64.b64encode(audio_bytes).decode("utf-8")

        # 根据文件扩展名推断 MIME 类型
        ext = Path(audio_path).suffix.lower()
        if ext == ".wav":
            mime_type = "audio/wav"
        elif ext in (".mp3", ".mpeg"):
            mime_type = "audio/mpeg"
        else:
            # 默认 mp3
            mime_type = "audio/mpeg"

        return await self.synthesize_voice_clone(
            text=text,
            audio_base64=audio_base64,
            mime_type=mime_type,
            instruction=instruction,
            format=format,
        )

    async def list_preset_voices(self) -> list:
        """返回预置音色列表"""
        return MIMO_PRESET_VOICES.copy()

    # ------------------------------------------------------------------
    # 内部同步方法
    # ------------------------------------------------------------------

    def _call_api_sync(
        self,
        model: str,
        messages: list,
        audio_params: dict,
    ) -> bytes:
        """
        同步调用 MiMo TTS API

        API 兼容 OpenAI Chat Completions 格式：
        POST /chat/completions
        Body: { model, messages, audio: { format, voice?, optimize_text_preview? } }
        Response: { choices: [{ message: { audio: { data: "<base64>" } } }] }
        """
        url = f"{self.base_url}/chat/completions"

        payload = {
            "model": model,
            "messages": messages,
            "audio": audio_params,
        }

        body = json.dumps(payload).encode("utf-8")

        req = urllib.request.Request(
            url,
            data=body,
            headers=self._get_headers(),
            method="POST",
        )

        try:
            logger.info(f"Calling MiMo TTS API: model={model}, audio_params={audio_params}")
            with urllib.request.urlopen(req, timeout=120) as resp:
                resp_data = json.loads(resp.read().decode("utf-8"))

            # 解析返回的音频数据
            choices = resp_data.get("choices", [])
            if not choices:
                raise RuntimeError("MiMo TTS API returned no choices")

            message = choices[0].get("message", {})
            audio_info = message.get("audio", {})
            audio_b64 = audio_info.get("data", "")

            if not audio_b64:
                raise RuntimeError("MiMo TTS API returned no audio data")

            logger.info(f"MiMo TTS API success: received {len(audio_b64)} chars of base64 audio")
            return base64.b64decode(audio_b64)

        except urllib.error.HTTPError as e:
            error_body = e.read().decode("utf-8", errors="replace")
            logger.error(f"MiMo TTS API HTTP error {e.code}: {error_body}")
            raise RuntimeError(f"MiMo TTS API error {e.code}: {error_body}")
        except urllib.error.URLError as e:
            logger.error(f"MiMo TTS API URL error: {e.reason}")
            raise RuntimeError(f"MiMo TTS API connection error: {e.reason}")
        except json.JSONDecodeError as e:
            logger.error(f"MiMo TTS API response JSON decode error: {e}")
            raise RuntimeError("MiMo TTS API returned invalid JSON")


# ------------------------------------------------------------------
# 全局单例
# ------------------------------------------------------------------

_mimo_tts_service: Optional[MiMoTTSService] = None
_mimo_tts_config_fingerprint: Optional[str] = None


def _make_mimo_fingerprint(api_key: str, base_url: str) -> str:
    return f"{api_key}:{base_url}"


async def get_mimo_tts_service(db=None) -> MiMoTTSService:
    """获取 MiMo TTS 服务单例。

    当传入 db (Session) 时，优先从界面配置读取 api_key/base_url；
    未传入 db 或界面未配置时，回退到 .env 默认值。
    配置变更时自动重建单例。
    """
    global _mimo_tts_service, _mimo_tts_config_fingerprint

    api_key = settings.mimo_api_key
    base_url = settings.mimo_base_url
    if db is not None:
        try:
            from app.core.model_config_service import get_effective_config
            config = get_effective_config(db, "mimo_tts")
            api_key = config.get("api_key") or api_key
            base_url = config.get("base_url") or base_url
        except Exception:
            pass  # 降级到 settings

    if not api_key:
        raise RuntimeError("MIMO_API_KEY is not configured (neither in UI nor .env)")

    fp = _make_mimo_fingerprint(api_key, base_url)
    if _mimo_tts_service is not None and _mimo_tts_config_fingerprint == fp:
        return _mimo_tts_service

    _mimo_tts_service = MiMoTTSService(
        api_key=api_key,
        base_url=base_url,
    )
    _mimo_tts_config_fingerprint = fp
    return _mimo_tts_service
