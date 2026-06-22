"""测试本地预筛效果"""
import sys, os, re
sys.stdout = __import__('io').TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from app.services.voice_to_srt_service import VoiceToSrt, detect_gpu
from app.services.llm_subtitle_service import _parse_srt_blocks, _local_prefilter

AUDIO = r'E:\repos\video_prjs\deepseek_strategy\out\deepseek_strategy.mp3'
DOCS  = r'E:\repos\video_prjs\deepseek_strategy\docs\配音旁白.txt'

def main():
    device, compute = detect_gpu()
    print(f'[1] GPU: {device}')

    service = VoiceToSrt()
    result = service.voicetosrt(input_file=AUDIO, file_id='prefilter', model_size='large-v3')
    blocks = _parse_srt_blocks(result.content)
    print(f'[2] Whisper: {len(blocks)} blocks')

    with open(DOCS, 'r', encoding='utf-8') as f:
        doc = f.read()
    print(f'[3] Doc: {len(doc)} chars')

    matched, suspects = _local_prefilter(blocks, doc, threshold=0.6)
    print(f'[4] Prefilter: matched={len(matched)}, suspects={len(suspects)}')
    print(f'    Saved: {len(matched)} blocks skipped from LLM')
    print(f'    LLM only needs to check {len(suspects)} blocks')

    print(f'\n[5] Suspect lines:')
    for s in suspects:
        ratio = s.get('_match_ratio', '?')
        print(f'  [{s["index"]}] ratio={ratio} | {s["text"]}')

if __name__ == '__main__':
    main()
