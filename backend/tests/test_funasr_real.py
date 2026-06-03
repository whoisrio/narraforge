"""手动验证 FunASR 转写功能

用法: .venv/bin/python -m pytest tests/test_funasr_real.py -v -s
或:   .venv/bin/python tests/test_funasr_real.py
"""

import sys
import uuid
import logging

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')

VOICE_DIR = "uploads/voices"
AUDIO_FILE = f"{VOICE_DIR}/2b910c78-9bc8-4970-9c15-3c5d76fb93bc.mp3"


def test_funasr_real():
    """用实际音频文件验证 FunASR 转写"""
    import os
    if not os.path.exists(AUDIO_FILE):
        print(f"SKIP: {AUDIO_FILE} not found")
        return

    from app.services.funasr_service import FunASRService

    svc = FunASRService()
    result = svc.transcribe(
        input_file=AUDIO_FILE,
        file_id=str(uuid.uuid4()),
        model_name="paraformer-zh",
        enable_vad=True,
        device="cpu",
    )

    print("\n========== FunASR 转写结果 ==========")
    print(result.content)
    print(f"\n语言: {result.language} ({result.language_probability})")
    print(f"设备: {result.device}")
    print(f"输出: {result.file_path}")
    print("=====================================\n")

    assert result.content, "转写结果为空"
    assert result.language == "zh"


if __name__ == "__main__":
    test_funasr_real()
