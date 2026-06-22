"""调试 FunASR 时间戳格式

.venv/bin/python tests/test_funasr_debug.py
"""

import sys
import os
import uuid
import logging

logging.basicConfig(level=logging.INFO)

VOICE_DIR = "uploads/voices"
AUDIO_FILE = f"{VOICE_DIR}/2b910c78-9bc8-4970-9c15-3c5d76fb93bc.mp3"


def main():
    if not os.path.exists(AUDIO_FILE):
        print(f"SKIP: {AUDIO_FILE} not found")
        return

    # 直接用 funasr AutoModel 看原始输出
    from funasr import AutoModel

    model = AutoModel(
        model="paraformer-zh",
        vad_model="fsmn-vad",
        punc_model="ct-punc",
        device="cpu",
    )

    results = model.generate(input=AUDIO_FILE, batch_size_s=300)

    for i, result in enumerate(results):
        text = result.get("text", "")
        ts = result.get("timestamp", [])
        print(f"\n=== Result {i} ===")
        print(f"Text ({len(text)} chars): {text}")
        print(f"Timestamps ({len(ts)} pairs): {ts[:10]}...")
        if ts:
            print(f"Last 5 timestamps: {ts[-5:]}")

        # 看看 timestamp 和 text 的对应关系
        print("\n--- 字符→时间戳 映射 ---")
        char_idx = 0
        for ci, ch in enumerate(text):
            if ord(ch) > 127 or ch.isalnum():
                if char_idx < len(ts):
                    print(f"  [{ci}] '{ch}' -> ts[{char_idx}] = {ts[char_idx]}")
                else:
                    print(f"  [{ci}] '{ch}' -> NO TIMESTAMP (idx {char_idx} >= {len(ts)})")
                char_idx += 1
            else:
                print(f"  [{ci}] '{ch}' -> (punctuation, skip)")


if __name__ == "__main__":
    main()
