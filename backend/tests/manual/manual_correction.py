"""校准功能端到端验证"""
import sys, io, os, re
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
_backend = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
if _backend not in sys.path:
    sys.path.insert(0, _backend)

from app.services.voice_to_srt_service import VoiceToSrt, detect_gpu
from app.services.llm_subtitle_service import correct_subtitles, _get_llm_config

AUDIO = r'E:\repos\video_prjs\deepseek_strategy\out\deepseek_strategy.mp3'
DOCS  = r'E:\repos\video_prjs\deepseek_strategy\docs\配音旁白.txt'

def cn_len(s):
    return len(re.findall(r'[\u4e00-\u9fff\u3400-\u4dbf]', s))

def main():
    # ---- Step 1: GPU + Whisper ----
    device, compute = detect_gpu()
    print("[1] GPU:", device, compute)

    service = VoiceToSrt()
    result = service.voicetosrt(
        input_file=AUDIO, file_id='e2e', model_size='large-v3',
    )
    print("[2] Whisper done, device=", result.device)

    # ---- Step 2: 字幕拆分统计 ----
    blocks = []
    for m in re.finditer(
        r'(\d+)\s*\n([\d:,]+\s*-->\s*[\d:,]+)\s*\n(.+?)(?=\n\d+\n|\Z)',
        result.content, re.DOTALL
    ):
        blocks.append({'i': int(m.group(1)), 't': m.group(3).strip()})

    lens = [cn_len(b['t']) for b in blocks]
    over15 = sum(1 for l in lens if l > 15)
    print("[3] 字幕:", len(blocks), "条, avg=", round(sum(lens)/len(lens), 1),
          "字, >15字:", over15, "条, max=", max(lens))

    # ---- Step 3: LLM 校准 ----
    _, base_url, model = _get_llm_config()
    print("[4] LLM:", model, "@", base_url)

    with open(DOCS, 'r', encoding='utf-8') as f:
        doc = f.read()
    print("[5] 原始文稿:", len(doc), "字")

    print("[6] 调用 LLM 校准 (可能需要 60-90 秒)...")
    try:
        correction = correct_subtitles(
            srt_content=result.content,
            original_document=doc,
        )
        print("[7] 校准结果:", len(correction.suggestions), "处")
        for s in correction.suggestions:
            print("  [" + str(s.index) + "] " + s.original)
            print("    -> " + s.suggested)
            print("    " + s.reason + " (" + s.confidence + ")")
    except Exception as e:
        print("[7] 校准异常:", e)
        # 直接调用 LLM 看原始返回
        import json, urllib.request, ssl
        from app.services.llm_subtitle_service import _call_llm, _parse_srt_blocks
        blocks = _parse_srt_blocks(result.content)
        srt_lines = ["[" + str(b["index"]) + "] " + b["text"] for b in blocks[:10]]
        srt_blob = "\n".join(srt_lines)
        raw = _call_llm([
            {"role": "system", "content": "你是字幕校对员。对比文稿和ASR字幕，只找错别字。返回JSON数组。"},
            {"role": "user", "content": "【原始文稿】\n" + doc[:500] + "\n\n【ASR字幕】\n" + srt_blob},
        ], temperature=0.1)
        print("LLM raw (first 500):", raw[:500])

if __name__ == '__main__':
    main()
