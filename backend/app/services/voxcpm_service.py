"""
VoxCPM 本地 GPU 语音合成服务

VoxCPM 是 OpenBMB 的 tokenizer-free TTS 系统，通过端到端扩散自回归架构
直接生成连续语音表示，绕过离散 tokenization，实现高度自然和富有表现力的合成。

本服务封装 VoxCPM2（2B 参数，30 语言，48kHz）的本地推理，支持：
1. 纯文本 TTS（无参考音频）
2. Voice Design（文本描述生成全新音色，无需参考音频）
3. Controllable Clone（参考音频克隆 + 可选风格控制）
4. Ultimate Clone（参考音频 + 转录文本，最高保真克隆）

所有配置从 .env 读取，严禁写死。
"""

import asyncio
import gc
import io
import logging
import os
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Dict, Optional

import numpy as np

from app.core.config import settings

logger = logging.getLogger(__name__)

# 线程池，用于将同步推理放到非阻塞线程
_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="voxcpm")


class VoxCPMService:
    """VoxCPM 本地推理服务 — 全局单例，管理模型生命周期"""

    def __init__(self):
        self.model = None           # VoxCPM 模型实例
        self.model_path: str = ""
        self.device: str = "auto"
        self.dtype: str = "auto"
        self.loaded: bool = False
        self.loading: bool = False
        self._load_time_sec: float = 0
        self._sample_rate: int = 48000  # VoxCPM2 默认 48kHz

    # ------------------------------------------------------------------
    # 生命周期管理
    # ------------------------------------------------------------------

    async def load_model(
        self,
        model_path: Optional[str] = None,
        device: Optional[str] = None,
        dtype: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        加载模型到 GPU。

        Returns:
            {success, device, vram_used_mb, load_time_sec, error}
        """
        if self.loading:
            return {"success": False, "error": "模型正在加载中，请稍候"}

        if self.loaded:
            return {
                "success": True,
                "device": self.device,
                "vram_used_mb": self._get_vram_used_mb(),
                "load_time_sec": self._load_time_sec,
                "message": "模型已加载",
            }

        self.loading = True
        model_path = model_path or settings.voxcpm_model_path
        device = device or settings.voxcpm_device
        dtype = dtype or settings.voxcpm_dtype

        try:
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(
                _executor,
                self._load_model_sync,
                model_path,
                device,
                dtype,
            )
            return result
        except Exception as e:
            logger.error(f"VoxCPM 模型加载失败: {e}")
            self.loading = False
            return {"success": False, "error": str(e)}

    def _load_model_sync(
        self, model_path: str, device: str, dtype: str
    ) -> Dict[str, Any]:
        """同步加载模型（在线程池中运行）"""
        try:
            start_time = time.time()

            # 延迟导入 voxcpm，避免模块加载时就要求 GPU
            from voxcpm import VoxCPM as VoxCPMModel

            # 如果是 HuggingFace 模型 ID（如 openbmb/VoxCPM2）且本地不存在，
            # 自动从 ModelScope 下载
            model_path = self._ensure_model_local(model_path)

            logger.info(f"开始加载 VoxCPM 模型: {model_path} (device={device}, dtype={dtype})")

            # 设置环境变量
            if device and device != "auto":
                os.environ["VOXCPM_DEVICE"] = device
            if dtype and dtype != "auto":
                os.environ["VOXCPM_DTYPE"] = dtype

            self.model = VoxCPMModel.from_pretrained(
                model_path,
                load_denoiser=False,
            )

            # 获取实际使用的设备
            try:
                actual_device = str(next(self.model.parameters()).device) if hasattr(self.model, 'parameters') else device
            except Exception:
                actual_device = device

            self.model_path = model_path
            self.device = actual_device
            self.dtype = dtype
            self.loaded = True
            self.loading = False
            self._load_time_sec = round(time.time() - start_time, 2)

            # 获取采样率
            try:
                if hasattr(self.model, 'tts_model') and hasattr(self.model.tts_model, 'sample_rate'):
                    self._sample_rate = self.model.tts_model.sample_rate
            except Exception:
                pass

            vram_mb = self._get_vram_used_mb()
            logger.info(
                f"VoxCPM 模型加载完成: device={actual_device}, "
                f"vram={vram_mb}MB, 耗时={self._load_time_sec}s"
            )

            return {
                "success": True,
                "device": actual_device,
                "vram_used_mb": vram_mb,
                "load_time_sec": self._load_time_sec,
                "sample_rate": self._sample_rate,
            }

        except ImportError as e:
            self.loading = False
            error_msg = (
                "voxcpm 包未安装。请运行: pip install voxcpm\n"
                f"原始错误: {e}"
            )
            logger.error(error_msg)
            return {"success": False, "error": error_msg}

        except Exception as e:
            self.loading = False
            logger.error(f"VoxCPM 模型加载异常: {e}", exc_info=True)
            return {"success": False, "error": str(e)}

    async def unload_model(self) -> Dict[str, Any]:
        """释放 GPU 显存"""
        if not self.loaded:
            return {"success": True, "message": "模型未加载，无需释放"}

        try:
            vram_before = self._get_vram_used_mb()

            # 释放模型
            if self.model is not None:
                del self.model
                self.model = None

            # 强制垃圾回收 + 清理 GPU 缓存
            gc.collect()
            try:
                import torch
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
                    torch.cuda.synchronize()
            except ImportError:
                pass

            self.loaded = False
            self.loading = False
            self.model_path = ""
            self.device = "auto"

            vram_after = self._get_vram_used_mb()
            freed_mb = max(0, vram_before - vram_after)

            logger.info(f"VoxCPM 模型已释放: freed={freed_mb}MB")
            return {
                "success": True,
                "freed_mb": freed_mb,
                "vram_before_mb": vram_before,
                "vram_after_mb": vram_after,
            }

        except Exception as e:
            logger.error(f"VoxCPM 模型释放失败: {e}", exc_info=True)
            return {"success": False, "error": str(e)}

    def get_status(self) -> Dict[str, Any]:
        """返回模型状态"""
        gpu_info = self._get_gpu_info()
        return {
            "loaded": self.loaded,
            "loading": self.loading,
            "device": self.device if self.loaded else settings.voxcpm_device,
            "model_path": self.model_path or settings.voxcpm_model_path,
            "sample_rate": self._sample_rate,
            "vram_used_mb": self._get_vram_used_mb() if self.loaded else 0,
            "gpu_total_mb": gpu_info.get("total_mb", 0),
            "gpu_free_mb": gpu_info.get("free_mb", 0),
            "load_time_sec": self._load_time_sec,
        }

    # ------------------------------------------------------------------
    # 推理接口
    # ------------------------------------------------------------------

    async def synthesize(
        self,
        text: str,
        mode: str = "tts",
        reference_audio_path: Optional[str] = None,
        prompt_text: Optional[str] = None,
        style_control: Optional[str] = None,
        cfg_value: Optional[float] = None,
        inference_timesteps: Optional[int] = None,
    ) -> bytes:
        """
        核心合成方法。

        Args:
            text: 合成文本
            mode: 合成模式 (tts / design / clone / ultimate)
            reference_audio_path: 参考音频文件路径（clone/ultimate 模式）
            prompt_text: 参考音频的转录文本（ultimate 模式）
            style_control: 风格控制描述（clone/ultimate 模式可选）
            cfg_value: CFG 强度覆盖
            inference_timesteps: 去噪步数覆盖

        Returns:
            WAV 音频字节
        """
        if not self.loaded:
            raise RuntimeError("VoxCPM 模型未加载，请先调用 load_model()")

        cfg_value = cfg_value or settings.voxcpm_cfg_value
        inference_timesteps = inference_timesteps or settings.voxcpm_inference_timesteps

        # 构建推理参数
        generate_kwargs = {
            "cfg_value": cfg_value,
            "inference_timesteps": inference_timesteps,
        }

        if mode == "design":
            # Voice Design: text 格式为 (描述)内容
            # 如果用户分开传了描述和文本，拼接起来
            if not text.startswith("("):
                # 自动拼接 Voice Design 格式
                pass  # text 已经是完整格式
        elif mode == "clone":
            if not reference_audio_path:
                raise ValueError("clone 模式需要 reference_audio_path")
            generate_kwargs["reference_wav_path"] = reference_audio_path
            if style_control:
                # 将风格控制加到文本前面
                text = f"({style_control}){text}"
        elif mode == "ultimate":
            if not reference_audio_path:
                raise ValueError("ultimate 模式需要 reference_audio_path")
            if not prompt_text:
                raise ValueError("ultimate 模式需要 prompt_text")
            generate_kwargs["prompt_wav_path"] = reference_audio_path
            generate_kwargs["prompt_text"] = prompt_text
            generate_kwargs["reference_wav_path"] = reference_audio_path  # 提高相似度
            if style_control:
                text = f"({style_control}){text}"
        # mode == "tts": 不需要额外参数

        generate_kwargs["text"] = text

        # 在线程池中执行同步推理
        loop = asyncio.get_event_loop()
        wav_array = await loop.run_in_executor(
            _executor,
            self._run_inference_sync,
            generate_kwargs,
        )

        # 转换为 WAV 字节
        wav_bytes = self._numpy_to_wav(wav_array)
        return wav_bytes

    def _run_inference_sync(self, generate_kwargs: Dict[str, Any]) -> np.ndarray:
        """同步推理（在线程池中运行）"""
        try:
            start_time = time.time()

            # 对于 clone 模式，根据 voice_id + text 生成固定 seed，保证相同输入产出一致
            ref_path = generate_kwargs.get("reference_wav_path") or generate_kwargs.get("prompt_wav_path")
            text = generate_kwargs.get("text", "")
            if ref_path:
                import random as _random
                seed = hash(f"{ref_path}") % (2**31)
                _random.seed(seed)
                try:
                    import torch
                    torch.manual_seed(seed)
                    if torch.cuda.is_available():
                        torch.cuda.manual_seed_all(seed)
                except ImportError:
                    pass
            
            logger.info(f'\nkwargs: {generate_kwargs}')
            wav = self.model.generate(**generate_kwargs)
            elapsed = round(time.time() - start_time, 2)

            # 计算音频时长
            duration = round(len(wav) / self._sample_rate, 2)
            rtf = round(elapsed / duration, 2) if duration > 0 else 0
            logger.info(
                f"VoxCPM 推理完成: 音频={duration}s, 耗时={elapsed}s, RTF={rtf}"
            )
            return wav

        except Exception as e:
            logger.error(f"VoxCPM 推理失败: {e}", exc_info=True)
            raise

    # ------------------------------------------------------------------
    # 内部工具方法
    # ------------------------------------------------------------------

    def _ensure_model_local(self, model_path: str) -> str:
        """
        确保模型权重在本地可用。
        如果 model_path 是 HuggingFace 模型 ID（如 'openbmb/VoxCPM2'）
        且本地不存在，则自动从 ModelScope 下载到 pretrained_models/ 目录。
        """
        # 已经是本地路径（绝对路径或相对路径，且目录存在）
        if os.path.isdir(model_path):
            return model_path

        # 判断是否是 HuggingFace 模型 ID（格式：org/model-name）
        if "/" not in model_path:
            return model_path

        # 转换为 ModelScope 的模型 ID
        # HuggingFace: openbmb/VoxCPM2 → ModelScope: OpenBMB/VoxCPM2
        ms_model_id = model_path.replace("openbmb/", "OpenBMB/")

        # 本地缓存目录
        local_dir = os.path.join(
            str(settings.base_dir), "pretrained_models", model_path.split("/")[-1]
        )

        if os.path.isdir(local_dir) and os.listdir(local_dir):
            logger.info(f"模型已存在于本地: {local_dir}")
            return local_dir

        # 从 ModelScope 下载
        logger.info(f"模型本地不存在，从 ModelScope 下载: {ms_model_id} → {local_dir}")
        try:
            from modelscope import snapshot_download

            snapshot_download(ms_model_id, local_dir=local_dir)
            logger.info(f"ModelScope 下载完成: {local_dir}")
            return local_dir
        except ImportError:
            logger.warning(
                "modelscope 未安装，尝试从 HuggingFace 下载（国内可能较慢）。"
                "建议先安装: pip install modelscope"
            )
            return model_path  # 回退到 HuggingFace（voxcpm from_pretrained 会自动下载）
        except Exception as e:
            logger.error(f"ModelScope 下载失败: {e}，回退到 HuggingFace")
            return model_path

    def _numpy_to_wav(self, wav_array: np.ndarray) -> bytes:
        """将 numpy 数组转换为 WAV 字节"""
        import soundfile as sf

        buf = io.BytesIO()
        sf.write(buf, wav_array, self._sample_rate, format="WAV")
        buf.seek(0)
        return buf.read()

    def _save_wav_temp(self, wav_bytes: bytes) -> str:
        """将 WAV 字节保存到临时文件，返回路径"""
        fd, path = tempfile.mkstemp(suffix=".wav", dir=str(settings.uploads_dir))
        with os.fdopen(fd, "wb") as f:
            f.write(wav_bytes)
        return path

    def _get_vram_used_mb(self) -> int:
        """获取当前 GPU 显存使用量 (MB)"""
        try:
            import torch
            if torch.cuda.is_available():
                return round(torch.cuda.memory_allocated(0) / 1024 / 1024)
        except Exception:
            pass
        return 0

    def _get_gpu_info(self) -> Dict[str, Any]:
        """获取 GPU 信息"""
        try:
            import torch
            if torch.cuda.is_available():
                total = torch.cuda.get_device_properties(0).total_memory
                allocated = torch.cuda.memory_allocated(0)
                free = total - allocated
                return {
                    "total_mb": round(total / 1024 / 1024),
                    "free_mb": round(free / 1024 / 1024),
                    "name": torch.cuda.get_device_name(0),
                }
        except Exception:
            pass
        return {"total_mb": 0, "free_mb": 0, "name": "N/A"}


# ------------------------------------------------------------------
# 全局单例
# ------------------------------------------------------------------

_service: Optional[VoxCPMService] = None


async def get_voxcpm_service() -> VoxCPMService:
    """获取 VoxCPM 服务单例"""
    global _service
    if _service is None:
        _service = VoxCPMService()
    return _service


async def close_voxcpm_service():
    """关闭 VoxCPM 服务（用于应用关闭时清理）"""
    global _service
    if _service is not None and _service.loaded:
        await _service.unload_model()
    _service = None
