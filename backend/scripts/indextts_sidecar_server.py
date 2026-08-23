"""
IndexTTS-2.5 sidecar HTTP 服务

在 third_party/index-tts 的独立 uv 环境（Python 3.11 + torch 2.8 cu128）中运行，
对本项目 backend 暴露 HTTP 接口，绕开 backend（py>=3.12）与 indextts（py<3.12）
的依赖硬冲突。

启动方式（务必在 third_party/index-tts 目录下运行，uv 会自动用该项目的 venv）：

    cd third_party/index-tts
    uv run ../../backend/scripts/indextts_sidecar_server.py

环境变量：
    INDEXTTS_SIDECAR_PORT   监听端口（默认 8310）
    INDEXTTS_MODEL_DIR      模型目录（默认 <index-tts repo>/checkpoints）
    INDEXTTS_REPO_DIR       index-tts 仓库路径（默认按本脚本相对位置推断）

接口：
    GET  /health      存活探针
    GET  /status      {loaded, device, vram_used_mb, load_time_sec}
    POST /load        加载模型（懒加载，已加载时幂等返回）
    POST /unload      卸载模型释放显存
    POST /synthesize  {text, lang, prompt_wav_path, emo_vector?, emo_alpha?,
                       duration_factor?} -> audio/wav
"""

import gc
import os
import sys
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

# --------------------------------------------------------------------------
# sys.path 引导：把 index-tts 仓库根目录加入 import 路径
# --------------------------------------------------------------------------
_SCRIPT_PATH = Path(__file__).resolve()
_DEFAULT_REPO_DIR = _SCRIPT_PATH.parents[2] / "third_party" / "index-tts"
REPO_DIR = Path(os.environ.get("INDEXTTS_REPO_DIR", str(_DEFAULT_REPO_DIR))).resolve()
if str(REPO_DIR) not in sys.path:
    sys.path.insert(0, str(REPO_DIR))

MODEL_DIR = Path(os.environ.get("INDEXTTS_MODEL_DIR", str(REPO_DIR / "checkpoints"))).resolve()
PORT = int(os.environ.get("INDEXTTS_SIDECAR_PORT", "8310"))

# 线程池：模型加载与推理全部串行化，避免并发进 GPU
_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="indextts")

app = FastAPI(title="IndexTTS-2.5 Sidecar", docs_url=None, redoc_url=None)


class _State:
    model = None
    device: str = "unknown"
    load_time_sec: float = 0.0


def _vram_used_mb() -> int:
    try:
        import torch

        if torch.cuda.is_available():
            return int(torch.cuda.memory_allocated() / 1024 / 1024)
    except Exception:
        pass
    return 0


def _load_model_sync() -> dict:
    if _State.model is not None:
        return {
            "success": True,
            "message": "模型已加载",
            "device": _State.device,
            "vram_used_mb": _vram_used_mb(),
            "load_time_sec": _State.load_time_sec,
        }
    cfg_path = MODEL_DIR / "config.yaml"
    if not cfg_path.exists():
        raise FileNotFoundError(f"模型配置不存在: {cfg_path}（请先下载 IndexTTS-2.5 权重）")

    from indextts.infer_v2_5 import IndexTTS2

    start = time.time()
    model = IndexTTS2(
        cfg_path=str(cfg_path),
        model_dir=str(MODEL_DIR),
        use_bf16=True,
    )
    _State.model = model
    _State.load_time_sec = round(time.time() - start, 2)
    _State.device = str(getattr(model, "device", "unknown"))
    return {
        "success": True,
        "device": _State.device,
        "vram_used_mb": _vram_used_mb(),
        "load_time_sec": _State.load_time_sec,
    }


def _unload_model_sync() -> dict:
    if _State.model is None:
        return {"success": True, "message": "模型未加载"}
    _State.model = None
    gc.collect()
    try:
        import torch

        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except Exception:
        pass
    return {"success": True, "vram_used_mb": _vram_used_mb()}


class SynthesizeRequest(BaseModel):
    text: str
    lang: str = "ZH"  # ZH / EN / JA / ES / AR
    prompt_wav_path: str
    # [happy, angry, sad, afraid, disgusted, melancholic, surprised, calm]
    emo_vector: Optional[list[float]] = None
    emo_alpha: float = Field(default=1.0, ge=0.0, le=1.0)
    duration_factor: float = Field(default=1.0, ge=0.5, le=2.0)


def _synthesize_sync(req: SynthesizeRequest) -> bytes:
    if _State.model is None:
        _load_model_sync()
    prompt = Path(req.prompt_wav_path)
    if not prompt.exists():
        raise FileNotFoundError(f"参考音频不存在: {prompt}")

    kwargs: dict = {
        "spk_audio_prompt": str(prompt),
        "text": req.text,
        "lang": req.lang,
        "verbose": False,
    }
    if req.emo_vector is not None:
        kwargs["emo_vector"] = req.emo_vector
        kwargs["emo_alpha"] = req.emo_alpha
    if req.duration_factor != 1.0:
        kwargs["duration_factor"] = req.duration_factor

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        out_path = tmp.name
    try:
        _State.model.infer(output_path=out_path, **kwargs)
        return Path(out_path).read_bytes()
    finally:
        try:
            os.unlink(out_path)
        except OSError:
            pass


@app.get("/health")
async def health():
    return {"ok": True}


@app.get("/status")
async def status():
    return {
        "loaded": _State.model is not None,
        "device": _State.device,
        "vram_used_mb": _vram_used_mb(),
        "load_time_sec": _State.load_time_sec,
        "model_dir": str(MODEL_DIR),
    }


@app.post("/load")
async def load():
    import asyncio

    loop = asyncio.get_event_loop()
    try:
        return await loop.run_in_executor(_executor, _load_model_sync)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/unload")
async def unload():
    import asyncio

    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(_executor, _unload_model_sync)


@app.post("/synthesize")
async def synthesize(req: SynthesizeRequest):
    import asyncio

    if not req.text.strip():
        raise HTTPException(status_code=400, detail="text 不能为空")
    loop = asyncio.get_event_loop()
    try:
        wav_bytes = await loop.run_in_executor(_executor, _synthesize_sync, req)
    except FileNotFoundError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    return Response(content=wav_bytes, media_type="audio/wav")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=PORT, log_level="info")
