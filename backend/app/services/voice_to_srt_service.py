import os
import sys
from datetime import datetime
from pathlib import Path
from faster_whisper import WhisperModel

os.environ['KMP_DUPLICATE_LIB_OK'] = 'True'

class VoiceToSrt:
    def _resolve_output_dir(self,output_path: str | None = None) -> Path:
        if output_path:
            p = Path(output_path)
        elif os.getenv('OUTPUT_DIR'):
            p = Path(os.getenv('OUTPUT_DIR'))
        else:
            p = Path(__file__).parent / 'output'
        p.mkdir(parents=True, exist_ok=True)
        return p

    def _resolve_output_filename(self,input_file: str, output_filename: str | None = None) -> str:
        if output_filename:
            return output_filename if output_filename.endswith('.srt') else output_filename + '.srt'
        stem = Path(input_file).stem
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        return f'{stem}_{timestamp}.srt'


    def _format_srt_time(self,seconds: float) -> str:
        h = int(seconds // 3600)
        m = int((seconds % 3600) // 60)
        s = int(seconds % 60)
        ms = int(round((seconds - int(seconds)) * 1000))
        return f'{h:02d}:{m:02d}:{s:02d},{ms:03d}'


    def voicetosrt(
        self,
        input_file: str,
        output_filename: str | None = None,
        output_path: str | None = None,
        model_size: str = 'large-v3',
        device: str = 'cpu',
        compute_type: str = 'int8',
        beam_size: int = 5,
    ) -> Path:
        """语音文件转 SRT 字幕文件。

        Args:
            input_file: 输入语音文件路径。
            output_filename: 输出文件名，默认为 {原文件名}_{日期}_{时分秒}.srt。
            output_path: 输出目录，优先级：参数 > .env OUTPUT_PATH > 脚本目录/output。
            model_size: Whisper 模型大小，默认 large-v3。
            device: 推理设备，默认 cpu。
            compute_type: 计算精度，默认 int8。
            beam_size: beam search 大小，默认 5。

        Returns:
            生成的 SRT 文件路径。
        """
        # 加载 .env
        from dotenv import load_dotenv
        load_dotenv()

        # 加载模型
        model = WhisperModel(model_size, device=device, compute_type=compute_type)

        # 转录
        segments, info = model.transcribe(input_file, beam_size=beam_size)
        print(f"Detected language '{info.language}' with probability {info.language_probability:.4f}")

        # 确定输出路径
        out_dir = self._resolve_output_dir(output_path)
        out_name = self._resolve_output_filename(input_file, output_filename)
        out_file = out_dir / out_name

        # 写入 SRT
        with open(out_file, 'w', encoding='utf-8') as f:
            for i, seg in enumerate(segments, start=1):
                f.write(f'{i}\n')
                f.write(f'{self._format_srt_time(seg.start)} --> {self._format_srt_time(seg.end)}\n')
                f.write(f'{seg.text.strip()}\n\n')

        print(f'SRT saved: {out_file}')
        return out_file


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
    vtosrt = VoiceToSrt()
    vtosrt.voicetosrt(
        input_file=args.input_file,
        output_filename=args.output_filename,
        output_path=args.output_path,
        model_size=args.model_size,
        device=args.device,
        compute_type=args.compute_type,
        beam_size=args.beam_size,
    )
