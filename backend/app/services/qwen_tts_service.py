"""
千问 (Qwen) TTS 语音合成服务
使用阿里云 DashScope API 进行语音合成和声音克隆
"""

import json
import uuid
import os
import asyncio
import urllib.request
import urllib.error
import urllib.parse
import base64
from pathlib import Path
from typing import Optional, Dict, Any
import logging
import ssl
import http.cookiejar

from app.core.config import settings

logger = logging.getLogger(__name__)


class QwenTTSService:
    """千问 TTS 服务"""

    # DashScope API endpoints
    BASE_URL = "https://dashscope.aliyuncs.com"
    TTS_API_PATH = "/api/v1/services/audio/tts/generation"
    TASK_QUERY_PATH = "/api/v1/services/audio/tts/query"
    VOICE_CLONE_API_PATH = "/api/v1/services/audio/voice_clone/instant-generation"  # 声音克隆

    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or settings.qwen_api_key
        if not self.api_key:
            raise ValueError("QWEN_API_KEY is not configured")

    def _get_headers(self) -> Dict[str, str]:
        """获取 API 请求头"""
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "X-Request-Id": str(uuid.uuid4()),
        }

    def _wait_for_task_completion(self, task_id: str, max_retries: int = 30, delay: float = 1.0) -> Dict:
        """轮询等待任务完成"""
        url = f"{self.BASE_URL}{self.TASK_QUERY_PATH}?task_id={task_id}"
        headers = self._get_headers()

        for _ in range(max_retries):
            try:
                req = urllib.request.Request(url, headers=headers)
                # 创建 SSL 上下文
                context = ssl.create_default_context()
                with urllib.request.urlopen(req, context=context) as response:
                    result = json.loads(response.read().decode("utf-8"))

                # 检查任务状态
                if "output" in result and "task_status" in result["output"]:
                    task_status = result["output"]["task_status"]

                    if task_status == "SUCCEEDED":
                        return result
                    elif task_status == "FAILED":
                        error_msg = result.get("output", {}).get("message", "Task failed")
                        raise Exception(f"TTS task failed: {error_msg}")
                    elif task_status == "PENDING" or task_status == "RUNNING":
                        time.sleep(delay)
                        continue

                time.sleep(delay)

            except urllib.error.HTTPError as e:
                logger.warning(f"HTTP error while querying task: {e}")
                time.sleep(delay)
                continue

        raise Exception("TTS task timeout")

    async def synthesize_speech(
        self,
        text: str,
        voice_id: str = "xiaoyun",
        speed: float = 1.0,
        volume: float = 80,
        pitch: int = 0,
        format: str = "wav",
        sample_rate: int = 16000,
    ) -> bytes:
        """
        合成语音 (异步版本，使用线程执行同步请求)

        Args:
            text: 要合成的文本
            voice_id: 声音 ID (如: xiaoyun, xiaoyuan, ruoxi, etc.)
            speed: 语速 (0.5-2.0)
            volume: 音量 (0-100)
            pitch: 音调 (-12 到 12)
            format: 音频格式 (wav, mp3)
            sample_rate: 采样率

        Returns:
            音频数据 (bytes)
        """
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None,
            self._synthesize_speech_sync,
            text, voice_id, speed, volume, pitch, format, sample_rate
        )

    def _synthesize_speech_sync(
        self,
        text: str,
        voice_id: str = "xiaoyun",
        speed: float = 1.0,
        volume: float = 80,
        pitch: int = 0,
        format: str = "wav",
        sample_rate: int = 16000,
    ) -> bytes:
        """同步执行 TTS 合成"""
        import time

        # 构建请求体
        request_body = {
            "model": "qwen-tts",
            "input": {
                "text": text,
            },
            "parameters": {
                "voice": voice_id,
                "speed_ratio": speed,
                "volume": volume,
                "pitch_ratio": pitch,
                "format": format,
                "sample_rate": sample_rate,
            },
        }

        url = f"{self.BASE_URL}{self.TTS_API_PATH}"
        headers = self._get_headers()

        logger.info(f"Calling Qwen TTS API with voice_id: {voice_id}, text: {text[:50]}...")

        try:
            # 提交 TTS 任务
            data = json.dumps(request_body).encode("utf-8")
            req = urllib.request.Request(url, data=data, headers=headers)
            context = ssl.create_default_context()

            with urllib.request.urlopen(req, context=context) as response:
                result = json.loads(response.read().decode("utf-8"))

            # 检查错误
            if "code" in result and result["code"] != "Success":
                error_msg = f"TTS API error: {result.get('message', 'Unknown error')}"
                logger.error(error_msg)
                raise Exception(error_msg)

            # 获取任务 ID
            task_id = None
            if "output" in result and "task_id" in result["output"]:
                task_id = result["output"]["task_id"]
            else:
                # 有些 API 可能直接返回音频
                if "output" in result and "audio" in result["output"]:
                    return base64.b64decode(result["output"]["audio"]["data"])
                logger.warning(f"Unexpected response: {result}")
                raise Exception("No task_id in response")

            # 等待任务完成
            completed_result = self._wait_for_task_completion(task_id)

            # 获取音频数据
            if "output" in completed_result and "audio" in completed_result["output"]:
                audio_data = completed_result["output"]["audio"]["data"]
                return base64.b64decode(audio_data)
            else:
                logger.warning(f"Unexpected completed result: {completed_result}")
                raise Exception("No audio in completed task")

        except urllib.error.HTTPError as e:
            error_msg = f"TTS API HTTP error: {e.code} - {e.read().decode('utf-8')}"
            logger.error(error_msg)
            raise Exception(error_msg)
        except urllib.error.URLError as e:
            logger.error(f"TTS API URL error: {e}")
            raise Exception(f"TTS API request failed: {str(e)}")

    async def clone_voice(
        self,
        reference_audio_path: str,
        text: str,
        speed: float = 1.0,
        volume: float = 80,
        pitch: int = 0,
        format: str = "wav",
        sample_rate: int = 16000,
    ) -> bytes:
        """
        声音克隆 - 使用参考音频进行语音合成 (异步版本)
        """
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None,
            self._clone_voice_sync,
            reference_audio_path, text, speed, volume, pitch, format, sample_rate
        )

    def _clone_voice_sync(
        self,
        reference_audio_path: str,
        text: str,
        speed: float = 1.0,
        volume: float = 80,
        pitch: int = 0,
        format: str = "wav",
        sample_rate: int = 16000,
    ) -> bytes:
        """同步执行声音克隆"""
        import time

        if not os.path.exists(reference_audio_path):
            raise FileNotFoundError(f"Reference audio not found: {reference_audio_path}")

        # 读取参考音频并转换为 Base64
        with open(reference_audio_path, "rb") as f:
            audio_content = f.read()

        audio_base64 = base64.b64encode(audio_content).decode("utf-8")

        # 构建请求体 - 声音克隆使用 qwen-tts-audio 模型
        request_body = {
            "model": "qwen-tts-audio",
            "input": {
                "text": text,
                "audio": audio_base64,
            },
            "parameters": {
                "speed_ratio": speed,
                "volume": volume,
                "pitch_ratio": pitch,
                "format": format,
                "sample_rate": sample_rate,
            },
        }

        url = f"{self.BASE_URL}{self.TTS_API_PATH}"
        headers = self._get_headers()

        logger.info(f"Calling Qwen Voice Cloning API")

        try:
            data = json.dumps(request_body).encode("utf-8")
            req = urllib.request.Request(url, data=data, headers=headers)
            context = ssl.create_default_context()

            with urllib.request.urlopen(req, context=context) as response:
                result = json.loads(response.read().decode("utf-8"))

            if "code" in result and result["code"] != "Success":
                error_msg = f"Voice Cloning API error: {result.get('message', 'Unknown error')}"
                logger.error(error_msg)
                raise Exception(error_msg)

            # 获取任务 ID
            task_id = None
            if "output" in result and "task_id" in result["output"]:
                task_id = result["output"]["task_id"]
            else:
                # 有些 API 可能直接返回音频
                if "output" in result and "audio" in result["output"]:
                    return base64.b64decode(result["output"]["audio"]["data"])
                logger.warning(f"Unexpected response: {result}")
                raise Exception("No task_id in response")

            # 等待任务完成
            completed_result = self._wait_for_task_completion(task_id)

            if "output" in completed_result and "audio" in completed_result["output"]:
                return base64.b64decode(completed_result["output"]["audio"]["data"])
            else:
                logger.warning(f"Unexpected completed result: {completed_result}")
                raise Exception("No audio in completed task")

        except urllib.error.HTTPError as e:
            error_msg = f"Voice Cloning API HTTP error: {e.code} - {e.read().decode('utf-8')}"
            logger.error(error_msg)
            raise Exception(error_msg)
        except urllib.error.URLError as e:
            logger.error(f"Voice Cloning API URL error: {e}")
            raise Exception(f"Voice Cloning API request failed: {str(e)}")

    async def register_cloned_voice(
        self,
        reference_audio_path: str,
        voice_name: str = "cloned_voice",
    ) -> Dict[str, Any]:
        """
        注册克隆声音 - 将参考音频提交给千问，创建持久的声音ID

        Args:
            reference_audio_path: 参考音频文件路径
            voice_name: 声音名称

        Returns:
            包含 voice_id, role 等信息的字典
        """
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None,
            self._register_cloned_voice_sync,
            reference_audio_path, voice_name
        )

    def _register_cloned_voice_sync(
        self,
        reference_audio_path: str,
        voice_name: str = "cloned_voice",
    ) -> Dict[str, Any]:
        """同步执行声音注册"""
        import time

        if not os.path.exists(reference_audio_path):
            raise FileNotFoundError(f"Reference audio not found: {reference_audio_path}")

        # 读取参考音频并转换为 Base64
        with open(reference_audio_path, "rb") as f:
            audio_content = f.read()

        audio_base64 = base64.b64encode(audio_content).decode("utf-8")

        # 构建请求体 - 使用声音克隆 API
        request_body = {
            "model": "qwen2-5-voiceclone-v2.5",  # 声音克隆模型
            "input": {
                "voice_name": voice_name,
                "audio": audio_base64,
            },
        }

        url = f"{self.BASE_URL}{self.VOICE_CLONE_API_PATH}"
        headers = self._get_headers()

        logger.info(f"Registering cloned voice: {voice_name}")

        try:
            data = json.dumps(request_body).encode("utf-8")
            req = urllib.request.Request(url, data=data, headers=headers)
            context = ssl.create_default_context()

            with urllib.request.urlopen(req, context=context) as response:
                result = json.loads(response.read().decode("utf-8"))

            logger.info(f"Voice clone response: {result}")

            if "code" in result and result["code"] != "Success":
                error_msg = f"Voice Registration API error: {result.get('message', 'Unknown error')}"
                logger.error(error_msg)
                raise Exception(error_msg)

            # 获取任务 ID 并等待完成
            task_id = None
            if "output" in result and "task_id" in result["output"]:
                task_id = result["output"]["task_id"]
            else:
                # 检查是否直接返回 voice_id（某些 API 可能会这样）
                if "output" in result and "voice_id" in result["output"]:
                    return {
                        "voice_id": result["output"]["voice_id"],
                        "voice_name": voice_name,
                        "role": result["output"].get("gender", "custom"),
                    }
                logger.warning(f"Unexpected response: {result}")
                raise Exception("No task_id in response")

            # 等待任务完成
            completed_result = self._wait_for_task_completion(task_id, max_retries=60, delay=2.0)

            # 获取声音 ID
            if "output" in completed_result:
                output_data = completed_result["output"]
                return {
                    "voice_id": output_data.get("voice_id", f"voice_{task_id}"),
                    "voice_name": voice_name,
                    "role": output_data.get("gender", "custom"),
                }
            else:
                logger.warning(f"Unexpected completed result: {completed_result}")
                # 如果没有返回 voice_id，使用 task_id 作为标识
                return {
                    "voice_id": f"voice_{task_id}",
                    "voice_name": voice_name,
                    "role": "custom",
                }

        except urllib.error.HTTPError as e:
            error_msg = f"Voice Registration API HTTP error: {e.code} - {e.read().decode('utf-8')}"
            logger.error(error_msg)
            raise Exception(error_msg)
        except urllib.error.URLError as e:
            logger.error(f"Voice Registration API URL error: {e}")
            raise Exception(f"Voice Registration API request failed: {str(e)}")


# 全局服务实例
_tts_service: Optional[QwenTTSService] = None


async def get_tts_service() -> QwenTTSService:
    """获取 TTS 服务实例"""
    global _tts_service
    if _tts_service is None:
        _tts_service = QwenTTSService()
    return _tts_service


async def close_tts_service():
    """关闭 TTS 服务"""
    global _tts_service
    if _tts_service is not None:
        _tts_service = None