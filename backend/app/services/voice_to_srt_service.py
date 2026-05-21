import os
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

os.environ['KMP_DUPLICATE_LIB_OK'] = 'True'


@dataclass
class SrtResult:
    file_path: Path
    content: str
    filename: str
    language: str
    language_probability: float


class VoiceToSrt:
    def _resolve_output_dir(self, output_path: str | None = None) -> Path:
        if output_path:
            p = Path(output_path)
        elif os.getenv('OUTPUT_DIR'):
            p = Path(os.getenv('OUTPUT_DIR'))
        else:
            p = Path(__file__).parent.parent.parent / 'output' / 'srt'
        p.mkdir(parents=True, exist_ok=True)
        return p

    def _resolve_output_filename(self, input_file: str, file_id: str, output_filename: str | None = None) -> str:
        if output_filename:
            name = output_filename if output_filename.endswith('.srt') else output_filename + '.srt'
            return f'{file_id}_{name}'
        stem = Path(input_file).stem
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        return f'{file_id}_{stem}_{timestamp}.srt'

    def _format_srt_time(self, seconds: float) -> str:
        h = int(seconds // 3600)
        m = int((seconds % 3600) // 60)
        s = int(seconds % 60)
        ms = int(round((seconds - int(seconds)) * 1000))
        return f'{h:02d}:{m:02d}:{s:02d},{ms:03d}'

    def voicetosrt(
        self,
        input_file: str,
        file_id: str,
        output_filename: str | None = None,
        output_path: str | None = None,
        model_size: str = 'large-v3',
        device: str = 'cpu',
        compute_type: str = 'int8',
        beam_size: int = 5,
    ) -> SrtResult:
        from faster_whisper import WhisperModel
        from dotenv import load_dotenv
        load_dotenv()

        model = WhisperModel(model_size, device=device, compute_type=compute_type)
        segments, info = model.transcribe(input_file, beam_size=beam_size)

        # Build SRT content in memory
        lines = []
        for i, seg in enumerate(segments, start=1):
            lines.append(str(i))
            lines.append(f'{self._format_srt_time(seg.start)} --> {self._format_srt_time(seg.end)}')
            lines.append(seg.text.strip())
            lines.append('')

        content = '\n'.join(lines)

        out_dir = self._resolve_output_dir(output_path)
        filename = self._resolve_output_filename(input_file, file_id, output_filename)
        out_file = out_dir / filename

        with open(out_file, 'w', encoding='utf-8') as f:
            f.write(content)

        return SrtResult(
            file_path=out_file,
            content=content,
            filename=filename,
            language=info.language,
            language_probability=info.language_probability,
        )


if __name__ == '__main__':
    import argparse

    parser = argparse.ArgumentParser(description='语音文件转 SRT 字幕')
    parser.add_argument('input_file', help='输入语音文件路径')
    parser.add_argument('-o', '--output-filename', default=None, help='输出文件名（默认: 原文件名_日期_时分秒.srt）')
    parser.add_argument('-p', '--output-path', default=None, help='输出目录（默认: .env OUTPUT_PATH 或脚本目录/output）')
    parser.add_argument('-m', '--model-size', default='large-v3', help='模型大小（默认: large-v3）')
    parser.add_argument('-d', '--device', default='cpu', help='推理设备（默认: cpu）')
    parser.add_argument('-c', '--compute-type', default='int8', help='计算精度（默认: int8）')
    parser.add_argument('-b', '--beam-size', type=int, default=5, help='beam search 大小（默认: 5）')

    args = parser.parse_args()
    import uuid
    vtosrt = VoiceToSrt()
    result = vtosrt.voicetosrt(
        input_file=args.input_file,
        file_id=str(uuid.uuid4()),
        output_filename=args.output_filename,
        output_path=args.output_path,
        model_size=args.model_size,
        device=args.device,
        compute_type=args.compute_type,
        beam_size=args.beam_size,
    )
    print(f'SRT saved: {result.file_path}')
    print(f'Language: {result.language} ({result.language_probability:.4f})')
