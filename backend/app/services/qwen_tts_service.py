"""
千问 (Qwen) TTS 语音合成服务
支持 TTS 系列和 CosyVoice 系列模型

模型系列说明：
- TTS 系列 (qwen-tts-*): 使用 HTTP API 进行语音合成
- CosyVoice 系列 (cosyvoice-*): 使用 WebSocket API 进行语音合成，支持声音复刻
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
from typing import Optional, Dict, Any, List
import logging
import ssl
import http.cookiejar
import time

from app.core.config import settings

logger = logging.getLogger(__name__)


class QwenTTSService:
    """千问 TTS 服务 - 支持 TTS 和 CosyVoice 两个系列"""

    # DashScope API endpoints
    BASE_URL = "https://dashscope.aliyuncs.com"
    # TTS 系列 API 路径
    TTS_API_PATH = "/api/v1/services/audio/tts/generation"
    TASK_QUERY_PATH = "/api/v1/services/audio/tts/query"
    # CosyVoice 系列使用声音复刻 API
    VOICE_ENROLLMENT_API_PATH = "/api/v1/services/audio/tts/customization"
    
    # 模型系列判断前缀
    COSYVOICE_PREFIX = "cosyvoice"
    TTS_PREFIX = "qwen-tts"

    def __init__(self, api_key: Optional[str] = None, model: Optional[str] = None):
        self.api_key = api_key or settings.qwen_api_key
        self.model = model or settings.qwen_model
        if not self.api_key:
            raise ValueError("QWEN_API_KEY is not configured")
        if not self.model:
            raise ValueError("QWEN_MODEL is not configured")
        
        # 根据模型名称判断使用哪个系列
        self.is_cosyvoice = self.model.lower().startswith(self.COSYVOICE_PREFIX)
        self.is_tts = self.model.lower().startswith(self.TTS_PREFIX)
        
        if not self.is_cosyvoice and not self.is_tts:
            logger.warning(f"Unknown model series: {self.model}. Using CosyVoice as default.")
            self.is_cosyvoice = True
        
        logger.info(f"Initialized Qwen TTS service with model: {self.model} (series: {'CosyVoice' if self.is_cosyvoice else 'TTS'})")

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
        """
        同步执行 TTS 合成 - 根据模型系列自动选择调用方式
        
        为什么需要判断模型系列：
        - TTS 系列 (qwen-tts-*): 使用 HTTP API，通过 task_id 轮询获取结果
        - CosyVoice 系列 (cosyvoice-*): 使用 WebSocket API，支持实时流式合成
        """
        if self.is_cosyvoice:
            return self._synthesize_speech_cosyvoice(text, voice_id, speed, volume, pitch, format, sample_rate)
        else:
            return self._synthesize_speech_tts(text, voice_id, speed, volume, pitch, format, sample_rate)

    def _synthesize_speech_tts(
        self,
        text: str,
        voice_id: str = "xiaoyun",
        speed: float = 1.0,
        volume: float = 80,
        pitch: int = 0,
        format: str = "wav",
        sample_rate: int = 16000,
    ) -> bytes:
        """TTS 系列模型的语音合成方法"""
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

    def _synthesize_speech_cosyvoice(
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
        CosyVoice 系列模型的语音合成方法
        
        为什么使用不同的 API：
        - CosyVoice 系列使用 WebSocket API 进行实时流式合成
        - 支持声音复刻音色（voice_id 为注册后的声音 ID）
        - 返回二进制音频数据而非 task_id
        
        API 文档参考：docs/qwen 语音合成 api 说明.md - Cosyvoice 系列模型
        """
        # CosyVoice 使用不同的模型名称和参数结构
        # 注意：voice_id 应该是注册后返回的声音 ID
        request_body = {
            "model": self.model,  # cosyvoice-v3.5-plus 或 cosyvoice-v3.5-flash
            "input": {
                "text": text,
            },
            "parameters": {
                "voice": voice_id,  # 使用注册的声音 ID 或预设音色
                "speed": speed,
                "volume": volume,
                "pitch": pitch,
                "format": format,
                "sample_rate": sample_rate,
                "response_mode": "streaming",  # CosyVoice 支持流式返回
            },
        }

        url = f"{self.BASE_URL}{self.TTS_API_PATH}"
        headers = self._get_headers()

        logger.info(f"Calling CosyVoice API with model: {self.model}, voice_id: {voice_id}, text: {text[:50]}...")

        try:
            data = json.dumps(request_body).encode("utf-8")
            req = urllib.request.Request(url, data=data, headers=headers)
            context = ssl.create_default_context()

            with urllib.request.urlopen(req, context=context) as response:
                # CosyVoice 可能直接返回音频数据或 task_id
                content_type = response.headers.get('Content-Type', '')
                
                if 'audio' in content_type:
                    # 直接返回音频数据
                    return response.read()
                else:
                    # 返回 JSON，可能包含 task_id
                    result = json.loads(response.read().decode("utf-8"))
                    
                    # 检查错误
                    if "code" in result and result["code"] != "Success":
                        error_msg = f"CosyVoice API error: {result.get('message', 'Unknown error')}"
                        logger.error(error_msg)
                        raise Exception(error_msg)
                    
                    # 如果有 task_id，轮询获取音频
                    if "output" in result and "task_id" in result["output"]:
                        task_id = result["output"]["task_id"]
                        logger.info(f"CosyVoice task submitted, task_id: {task_id}")
                        
                        completed_result = self._wait_for_task_completion(task_id)
                        
                        if "output" in completed_result and "audio" in completed_result["output"]:
                            return base64.b64decode(completed_result["output"]["audio"]["data"])
                        else:
                            raise Exception("No audio in completed task")
                    elif "output" in result and "audio" in result["output"]:
                        # 直接返回 base64 音频
                        return base64.b64decode(result["output"]["audio"]["data"])
                    else:
                        logger.warning(f"Unexpected CosyVoice response: {result}")
                        raise Exception("Unexpected CosyVoice response format")

        except urllib.error.HTTPError as e:
            error_msg = f"CosyVoice API HTTP error: {e.code} - {e.read().decode('utf-8')}"
            logger.error(error_msg)
            raise Exception(error_msg)
        except urllib.error.URLError as e:
            logger.error(f"CosyVoice API URL error: {e}")
            raise Exception(f"CosyVoice API request failed: {str(e)}")

    async def clone_voice(
        self,
        voice_id: str,
        text: str,
        speed: float = 1.0,
        volume: float = 80,
        pitch: int = 0,
        format: str = "wav",
        sample_rate: int = 16000,
    ) -> bytes:
        """
        声音克隆 - 使用已注册的 voice_id 进行语音合成 (异步版本)

        Args:
            voice_id: 注册后返回的 voice 参数
            text: 要合成的文本
            speed: 语速
            volume: 音量
            pitch: 音调
            format: 音频格式
            sample_rate: 采样率
        """
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None,
            self._clone_voice_sync,
            voice_id, text, speed, volume, pitch, format, sample_rate
        )

    def _clone_voice_sync(
        self,
        voice_id: str,
        text: str,
        speed: float = 1.0,
        volume: float = 80,
        pitch: int = 0,
        format: str = "wav",
        sample_rate: int = 16000,
    ) -> bytes:
        """
        同步执行声音克隆 - 根据模型系列自动选择调用方式
        
        为什么需要判断模型系列：
        - TTS 系列：使用 qwen3-tts-vc-2026-01-22 模型进行声音克隆
        - CosyVoice 系列：使用 cosyvoice 模型和注册的 voice_id 进行合成
        """
        if self.is_cosyvoice:
            return self._clone_voice_cosyvoice(voice_id, text, speed, volume, pitch, format, sample_rate)
        else:
            return self._clone_voice_tts(voice_id, text, speed, volume, pitch, format, sample_rate)

    def _clone_voice_tts(
        self,
        voice_id: str,
        text: str,
        speed: float = 1.0,
        volume: float = 80,
        pitch: int = 0,
        format: str = "wav",
        sample_rate: int = 16000,
    ) -> bytes:
        """TTS 系列模型的声音克隆方法"""
        import time

        # 使用 qwen3-tts-vc-2026-01-22 模型和已注册的 voice_id
        request_body = {
            "model": "qwen3-tts-vc-2026-01-22",
            "input": {
                "text": text,
                "voice": voice_id,  # 使用注册返回的 voice 参数
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

        logger.info(f"Calling Qwen TTS Voice Clone API with voice_id: {voice_id}")

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
            completed_result = self._wait_for_task_completion(task_id, max_retries=60, delay=2.0)
            logger.info(f"Task completed. Result: {completed_result}")

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

    def _clone_voice_cosyvoice(
        self,
        voice_id: str,
        text: str,
        speed: float = 1.0,
        volume: float = 80,
        pitch: int = 0,
        format: str = "wav",
        sample_rate: int = 16000,
    ) -> bytes:
        """
        CosyVoice 系列模型的声音克隆方法
        
        使用 dashscope SDK 的 SpeechSynthesizer 进行语音合成：
        1. 配置全局 dashscope.api_key 和 base_http_api_url
        2. 创建 SpeechSynthesizer 实例，传入 model 和 voice
        3. 调用 call() 方法返回二进制音频数据
        
        为什么使用 SDK：
        - 示例代码使用 SpeechSynthesizer.call() 直接返回音频
        - 避免 HTTP API 的 url error 问题
        - 支持更多参数（speech_rate, volume, pitch 等）
        """
        import dashscope
        from dashscope.audio.tts_v2 import SpeechSynthesizer
        
        # 配置全局 API Key 和 URL（根据示例代码）
        dashscope.api_key = self.api_key
        dashscope.base_http_api_url = 'https://dashscope.aliyuncs.com/api/v1'
        
        logger.info(f"Synthesizing speech with CosyVoice: model={self.model}, voice={voice_id}")
        
        try:
            # 创建 SpeechSynthesizer 实例
            # 根据示例代码，参数包括：model, voice, speech_rate 等
            # 注意：pitch 和 volume 参数可能不被支持
            synthesizer = SpeechSynthesizer(
                model=self.model,
                voice=voice_id,
                speech_rate=speed
            )
            
            # 调用 call() 方法返回二进制音频数据
            audio_data = synthesizer.call(text)
            
            logger.info(f"Speech synthesis successful. Request ID: {synthesizer.get_last_request_id()}")
            
            return audio_data
            
        except Exception as e:
            error_msg = f"SpeechSynthesizer error: {e}"
            logger.error(error_msg)
            raise Exception(error_msg)

    async def register_cloned_voice(
        self,
        reference_audio_path: str,
        voice_name: str = "cloned_voice",
    ) -> Dict[str, Any]:
        """
        注册克隆声音 - 将参考音频提交给千问，创建持久的声音 ID

        Args:
            reference_audio_path: 参考音频文件路径
            voice_name: 声音名称（用于显示，不直接用于 API）

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
        """
        同步执行声音注册 - 根据模型系列自动选择调用方式
        
        为什么需要判断模型系列：
        - TTS 系列：使用 qwen-voice-enrollment 模型进行声音注册
        - CosyVoice 系列：使用 VoiceEnrollmentService 进行声音复刻
        
        注意：
        - Qwen API 支持的音频格式：MP3, WAV, OGG
        - WebM 格式会在上传时自动转换为 MP3
        - preferred_name 使用克隆时间戳，避免特殊字符问题
        """
        if self.is_cosyvoice:
            return self._register_cloned_voice_cosyvoice(reference_audio_path, voice_name)
        else:
            return self._register_cloned_voice_tts(reference_audio_path, voice_name)

    def _register_cloned_voice_tts(
        self,
        reference_audio_path: str,
        voice_name: str = "cloned_voice",
    ) -> Dict[str, Any]:
        """TTS 系列模型的声音注册方法"""
        import time
        from datetime import datetime

        if not os.path.exists(reference_audio_path):
            raise FileNotFoundError(f"Reference audio not found: {reference_audio_path}")

        # 检查音频格式并确定 MIME 类型
        file_ext = os.path.splitext(reference_audio_path)[1].lower()
        mime_type_map = {
            ".mp3": "audio/mpeg",
            ".wav": "audio/wav",
            ".ogg": "audio/ogg",
        }
        mime_type = mime_type_map.get(file_ext, "audio/mpeg")
        
        # 如果是不支持的格式，记录错误
        if file_ext not in mime_type_map:
            logger.error(f"Unsupported audio format for Qwen API: {file_ext}. File: {reference_audio_path}")
            raise ValueError(f"Unsupported audio format: {file_ext}. Expected MP3, WAV, or OGG.")

        # 读取参考音频并转换为 Base64（data URI 格式）
        with open(reference_audio_path, "rb") as f:
            audio_content = f.read()

        audio_base64 = base64.b64encode(audio_content).decode("utf-8")
        # 使用 data URI 格式
        data_uri = f"data:{mime_type};base64,{audio_base64}"

        # 构建请求体 - 使用 qwen-voice-enrollment 模型
        # preferred_name 使用克隆时间戳
        # 注意：仅允许数字和小写字母，少于 10 个字符
        # 格式：clone + HHMMSS（6 位时间秒数，共 11 位）
        timestamp = datetime.now().strftime("%H%M%S")
        preferred_name = f"clone{timestamp}"
        
        request_body = {
            "model": "qwen-voice-enrollment",
            "input": {
                "action": "create",
                "target_model": "qwen3-tts-vc-2026-01-22",
                "preferred_name": preferred_name,
                "audio": {"data": data_uri},
            },
        }

        url = f"{self.BASE_URL}{self.VOICE_ENROLLMENT_API_PATH}"
        headers = self._get_headers()

        logger.info(f"Registering cloned voice (TTS series): {voice_name} (preferred_name: {preferred_name})")
        logger.info(f"Request URL: {url}")
        logger.info(f"Full request body: {json.dumps(request_body, ensure_ascii=False)}")

        try:
            data = json.dumps(request_body).encode("utf-8")
            req = urllib.request.Request(url, data=data, headers=headers)
            context = ssl.create_default_context()

            with urllib.request.urlopen(req, context=context) as response:
                result = json.loads(response.read().decode("utf-8"))

            logger.info(f"Voice clone raw response: {result}")

            # 检查 API 是否直接返回错误
            if "code" in result and result["code"] != "Success":
                error_msg = f"Voice Registration API error: {result.get('message', 'Unknown error')}"
                logger.error(error_msg)
                raise Exception(error_msg)

            # 根据文档，API 直接返回 output.voice 对象
            # 文档示例：return resp.json()["output"]["voice"]
            if "output" in result and "voice" in result["output"]:
                voice_data = result["output"]["voice"]
                logger.info(f"Voice data from API: {voice_data}")
                
                # voice_data 可能包含 voice_id, name 等信息
                # 根据文档，voice 对象包含必要的声音信息
                if isinstance(voice_data, dict):
                    voice_id = voice_data.get("voice_id") or voice_data.get("id") or voice_data.get("voice")
                    if not voice_id:
                        # 如果 voice 对象没有明确的 ID 字段，使用整个 voice 字符串/对象
                        voice_id = str(voice_data)
                    
                    return {
                        "voice_id": voice_id,
                        "voice_name": voice_name,
                        "role": voice_data.get("gender", "custom"),
                        "raw_voice_data": voice_data,
                    }
                else:
                    # 如果 voice 是字符串而不是对象
                    return {
                        "voice_id": str(voice_data),
                        "voice_name": voice_name,
                        "role": "custom",
                        "raw_voice_data": voice_data,
                    }
            
            # 如果没有返回 voice 对象，检查是否有 task_id（备用方案）
            if "output" in result and "task_id" in result["output"]:
                task_id = result["output"]["task_id"]
                logger.info(f"Task ID: {task_id}, waiting for completion...")
                
                # 等待任务完成（音色注册需要更长时间）
                completed_result = self._wait_for_task_completion(task_id, max_retries=60, delay=2.0)
                logger.info(f"Task completed. Result: {completed_result}")

                # 获取声音 ID
                if "output" in completed_result:
                    output_data = completed_result["output"]
                    voice_id = output_data.get("voice_id")
                    if not voice_id:
                        logger.warning(f"Voice registration completed but no voice_id returned: {output_data}")
                        voice_id = f"voice_{task_id}"
                    
                    logger.info(f"Final voice_id: {voice_id}")
                    
                    return {
                        "voice_id": voice_id,
                        "voice_name": voice_name,
                        "role": output_data.get("gender", "custom"),
                    }
            
            # 最坏情况：无法解析响应
            logger.warning(f"Unexpected response: {result}")
            return {
                "voice_id": f"voice_unknown",
                "voice_name": voice_name,
                "role": "custom",
            }

        except urllib.error.HTTPError as e:
            error_body = e.read().decode('utf-8')
            error_msg = f"Voice Registration API HTTP error: {e.code} - {error_body}"
            logger.error(error_msg)
            raise Exception(error_msg)
        except urllib.error.URLError as e:
            logger.error(f"Voice Registration API URL error: {e}")
            raise Exception(f"Voice Registration API request failed: {str(e)}")
        except Exception as e:
            logger.error(f"Voice Registration failed: {str(e)}")
            raise

    def _register_cloned_voice_cosyvoice(
        self,
        reference_audio_path: str,
        voice_name: str = "cloned_voice",
    ) -> Dict[str, Any]:
        """
        CosyVoice 系列模型的声音注册方法

        根据 Qwen 文档，CosyVoice 需要：
        1. 使用公网可访问的音频 URL（而不是 base64）
        2. 调用 VoiceEnrollmentService.create_voice() 创建音色
        3. 轮询 query_voice() 等待 status 变为 "OK"
        4. 使用返回的 voice_id 进行语音合成

        注意：
        - 需要提供公网可访问的音频 URL
        - 可以通过 external_audio_url 参数直接传入外部音频 URL（如七牛云、AWS S3 等）
        - 如果没有提供 external_audio_url，则需要配置 PUBLIC_BASE_URL 环境变量
        """
        import time
        from datetime import datetime

        # 检查是否是外部 URL
        is_external_url = reference_audio_path.startswith(('http://', 'https://'))
        
        if not is_external_url:
            # 本地文件路径检查
            if not os.path.exists(reference_audio_path):
                raise FileNotFoundError(f"Reference audio not found: {reference_audio_path}")

            # 检查音频格式
            file_ext = os.path.splitext(reference_audio_path)[1].lower()
            supported_formats = [".mp3", ".wav", ".ogg"]
            if file_ext not in supported_formats:
                logger.error(f"Unsupported audio format for CosyVoice API: {file_ext}. File: {reference_audio_path}")
                raise ValueError(f"Unsupported audio format: {file_ext}. Expected MP3, WAV, or OGG.")

        # 构建公网可访问的音频 URL
        # 优先使用外部传入的 audio_url，其次使用 PUBLIC_BASE_URL
        audio_url = None
        
        # 如果 reference_audio_path 已经是 URL（以 http 开头），直接使用
        if is_external_url:
            audio_url = reference_audio_path
            logger.info(f"Using external audio URL: {audio_url}")
            
            # 从 URL 推断文件格式
            url_without_params = reference_audio_path.split('?')[0]
            file_ext = '.' + url_without_params.split('.')[-1].lower() if '.' in url_without_params else '.mp3'
            supported_formats = [".mp3", ".wav", ".ogg", ".webm"]
            if file_ext not in supported_formats:
                logger.warning(f"URL may not be a supported audio format: {file_ext}")
        else:
            # 从文件路径中提取 voice_id（文件名）
            voice_id_from_path = os.path.splitext(os.path.basename(reference_audio_path))[0]
            # 尝试从 PUBLIC_BASE_URL 构建
            public_base_url = getattr(settings, 'public_base_url', None) or os.environ.get("PUBLIC_BASE_URL")
            if public_base_url:
                audio_url = f"{public_base_url.rstrip('/')}/api/clone/audio/{voice_id_from_path}"
                logger.info(f"Using audio URL from PUBLIC_BASE_URL: {audio_url}")
            else:
                raise ValueError(
                    "PUBLIC_BASE_URL not configured. CosyVoice requires a publicly accessible URL for audio files. "
                    "Please either: "
                    "1. Set PUBLIC_BASE_URL environment variable (e.g., https://your-domain.com), or "
                    "2. Provide an external audio URL directly (e.g., from cloud storage like Qiniu, AWS S3)"
                )

        # CosyVoice 的 prefix 要求：仅允许数字和小写字母，少于 10 个字符
        timestamp = datetime.now().strftime("%H%M%S")
        voice_prefix = f"clone{timestamp}"[:9]  # 确保少于 10 个字符

        # 使用 dashscope SDK 的 VoiceEnrollmentService
        logger.info(f"Registering cloned voice (CosyVoice series): {voice_name} (prefix: {voice_prefix})")
        logger.info(f"Audio URL: {audio_url}")
        logger.info(f"Target model: {self.model}")
        
        try:
            import dashscope
            from dashscope.audio.tts_v2 import VoiceEnrollmentService, VoiceEnrollmentException
            
            # 配置全局 API Key（根据示例代码）
            dashscope.api_key = self.api_key
            
            # 创建 VoiceEnrollmentService 实例
            # 注意：根据示例代码，VoiceEnrollmentService 不需要传入 api_key 参数
            service = VoiceEnrollmentService()
            
            # 调用 create_voice 创建音色
            # target_model: 克隆音色对应的语音合成模型版本
            # prefix: 音色自定义前缀，仅允许数字和小写字母，小于十个字符
            # url: 用于克隆的音频文件 url
            voice_id = service.create_voice(
                target_model=self.model,  # 使用配置的模型名称
                prefix=voice_prefix,
                url=audio_url
            )
            
            logger.info(f"Voice created successfully. voice_id: {voice_id}")
            logger.info(f"Request ID: {service.get_last_request_id()}")
            
            # 轮询等待声音状态变为 OK
            final_voice_id = self._wait_for_voice_ready_cosyvoice(service, voice_id)
            
            return {
                "voice_id": final_voice_id,
                "voice_name": voice_name,
                "role": "custom",
            }
            
        except VoiceEnrollmentException as e:
            error_msg = f"VoiceEnrollmentService error: {e}"
            logger.error(error_msg)
            raise Exception(error_msg)
        except Exception as e:
            logger.error(f"CosyVoice Registration failed: {str(e)}")
            raise

    def _wait_for_voice_ready_cosyvoice(self, service, voice_id: str, max_attempts: int = 30, poll_interval: float = 10.0) -> str:
        """
        轮询等待声音注册状态变为 OK（使用 dashscope SDK 的 query_voice 方法）

        根据示例代码，使用 VoiceEnrollmentService.query_voice() 查询状态

        Args:
            service: VoiceEnrollmentService 实例
            voice_id: 创建音色时返回的 voice_id
            max_attempts: 最大轮询次数
            poll_interval: 每次轮询的间隔（秒）

        Returns:
            准备好的 voice_id
        """
        logger.info(f"Waiting for voice ready (CosyVoice): {voice_id}, max_attempts: {max_attempts}, interval: {poll_interval}s")

        for attempt in range(max_attempts):
            try:
                # 使用 SDK 的 query_voice 方法查询状态
                voice_info = service.query_voice(voice_id=voice_id)
                status = voice_info.get("status")
                
                logger.info(f"Voice query attempt {attempt + 1}/{max_attempts}: status='{status}', voice_info={voice_info}")

                if status == "OK":
                    logger.info(f"Voice is ready! voice_id: {voice_id}")
                    return voice_id
                elif status == "UNDEPLOYED":
                    error_msg = f"Voice processing failed with status: {status}. Please check audio quality or contact support."
                    logger.error(error_msg)
                    raise RuntimeError(error_msg)
                # 对于 "DEPLOYING" 等中间状态，继续等待
                
                time.sleep(poll_interval)

            except Exception as e:
                logger.warning(f"Error during voice query: {e}")
                time.sleep(poll_interval)
                continue

        # 超时
        error_msg = f"Voice registration timeout: voice_id {voice_id} is not ready after {max_attempts} attempts"
        logger.error(error_msg)
        raise RuntimeError(error_msg)

    def _wait_for_voice_ready(self, voice_id: str, max_attempts: int = 30, poll_interval: float = 10.0) -> str:
        """
        轮询等待声音注册状态变为 OK

        根据文档，需要轮询 query_voice() 直到 status = "OK"

        Args:
            voice_id: 创建音色时返回的 voice_id
            max_attempts: 最大轮询次数
            poll_interval: 每次轮询的间隔（秒）

        Returns:
            准备好的 voice_id
        """
        from datetime import datetime

        # 构建查询请求体
        query_request_body = {
            "model": "qwen-voice-enrollment",
            "input": {
                "action": "query",
                "voice_id": voice_id,
            },
        }

        url = f"{self.BASE_URL}{self.VOICE_ENROLLMENT_API_PATH}"
        headers = self._get_headers()

        logger.info(f"Waiting for voice ready: {voice_id}, max_attempts: {max_attempts}, interval: {poll_interval}s")

        for attempt in range(max_attempts):
            try:
                data = json.dumps(query_request_body).encode("utf-8")
                req = urllib.request.Request(url, data=data, headers=headers, method="POST")
                context = ssl.create_default_context()

                with urllib.request.urlopen(req, context=context) as response:
                    result = json.loads(response.read().decode("utf-8"))

                logger.info(f"Voice query attempt {attempt + 1}/{max_attempts}: {result}")

                # 检查 API 错误
                if "code" in result and result["code"] != "Success":
                    logger.warning(f"Voice query API error: {result.get('message', 'Unknown error')}")
                    time.sleep(poll_interval)
                    continue

                # 检查状态
                if "output" in result and "voice" in result["output"]:
                    voice_data = result["output"]["voice"]
                    status = voice_data.get("status") if isinstance(voice_data, dict) else None

                    logger.info(f"Voice status: {status}")

                    if status == "OK":
                        logger.info(f"Voice is ready! voice_id: {voice_id}")
                        return voice_id
                    elif status == "UNDEPLOYED":
                        error_msg = f"Voice processing failed with status: {status}. Please check audio quality or contact support."
                        logger.error(error_msg)
                        raise RuntimeError(error_msg)
                    # 对于 "DEPLOYING" 等中间状态，继续等待

                time.sleep(poll_interval)

            except urllib.error.HTTPError as e:
                logger.warning(f"HTTP error during voice query: {e.code} - {e.read().decode('utf-8')}")
                time.sleep(poll_interval)
                continue
            except Exception as e:
                logger.warning(f"Error during voice query: {e}")
                time.sleep(poll_interval)
                continue

        # 超时
        error_msg = f"Voice registration timeout: voice_id {voice_id} is not ready after {max_attempts} attempts"
        logger.error(error_msg)
        raise RuntimeError(error_msg)

    async def list_cloned_voices(self) -> List[Dict[str, Any]]:
        """
        列出已克隆的声音 - 从千问 API 获取所有已注册的声音

        Returns:
            包含已克隆声音列表的字典
        """
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None,
            self._list_cloned_voices_sync
        )

    def _list_cloned_voices_sync(self) -> List[Dict[str, Any]]:
        """
        同步执行列出已克隆的声音

        调用 qwen-voice-enrollment API 的 list action 获取所有已注册的声音
        """
        # 构建请求体 - 使用 action: "list"
        request_body = {
            "model": "qwen-voice-enrollment",
            "input": {
                "action": "list",
            },
        }

        url = f"{self.BASE_URL}{self.VOICE_ENROLLMENT_API_PATH}"
        headers = self._get_headers()

        logger.info(f"Listing cloned voices from Qwen API")

        try:
            data = json.dumps(request_body).encode("utf-8")
            req = urllib.request.Request(url, data=data, headers=headers, method="POST")
            context = ssl.create_default_context()

            with urllib.request.urlopen(req, context=context) as response:
                result = json.loads(response.read().decode("utf-8"))

            logger.info(f"List voices response: {result}")

            # 检查 API 错误
            if "code" in result and result["code"] != "Success":
                error_msg = f"List voices API error: {result.get('message', 'Unknown error')}"
                logger.error(error_msg)
                raise Exception(error_msg)

            # 解析返回的声音列表
            if "output" in result and "voices" in result["output"]:
                voices = result["output"]["voices"]
                logger.info(f"Qwen voices response: {json.dumps(voices, ensure_ascii=False)}")
                return [
                    {
                        "voice_id": v.get("voice_id"),
                        "name": v.get("preferred_name", v.get("name")),
                        "status": v.get("status", "UNKNOWN"),
                        "role": v.get("gender", v.get("role", "custom")),
                    }
                    for v in voices
                ]

            # 如果没有 voices 字段，返回空列表
            logger.warning(f"No voices in response: {result}")
            return []

        except urllib.error.HTTPError as e:
            error_body = e.read().decode('utf-8')
            error_msg = f"List voices API HTTP error: {e.code} - {error_body}"
            logger.error(error_msg)
            raise Exception(error_msg)
        except urllib.error.URLError as e:
            logger.error(f"List voices API URL error: {e}")
            raise Exception(f"List voices API request failed: {str(e)}")
        except Exception as e:
            logger.error(f"List voices failed: {str(e)}")
            raise


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