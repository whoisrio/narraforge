import logging
import os
import sys
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from faster_whisper import WhisperModel
from dotenv import load_dotenv

os.environ['KMP_DUPLICATE_LIB_OK'] = 'True'

# ---------------------------------------------------------------------------
# 日志配置：同时输出到控制台和文件，确保模型下载进度在两种输出中可见
# ---------------------------------------------------------------------------
_logger = logging.getLogger('voice_to_srt')
_logger.setLevel(logging.INFO)

_console_handler = logging.StreamHandler(sys.stdout)
_console_handler.setFormatter(logging.Formatter(
    '%(asctime)s [%(levelname)s] %(message)s', datefmt='%Y-%m-%d %H:%M:%S'
))
_logger.addHandler(_console_handler)

_log_dir = Path(__file__).parent.parent.parent / 'logs'
_log_dir.mkdir(parents=True, exist_ok=True)
_file_handler = logging.FileHandler(_log_dir / 'voice_to_srt.log', encoding='utf-8')
_file_handler.setFormatter(logging.Formatter(
    '%(asctime)s [%(levelname)s] %(message)s', datefmt='%Y-%m-%d %H:%M:%S'
))
_logger.addHandler(_file_handler)

# 将 huggingface_hub 内部的下载日志也转发到我们的输出，以便看到传输详情
_hf_logger = logging.getLogger('huggingface_hub')
_hf_logger.setLevel(logging.INFO)
_hf_logger.addHandler(_console_handler)
_hf_logger.addHandler(_file_handler)


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

    # ------------------------------------------------------------------
    # faster_whisper 内置的模型名称到 HuggingFace repo_id 的映射
    # ------------------------------------------------------------------
    _MODEL_REPOS: dict[str, str] = {
        'tiny.en':              'Systran/faster-whisper-tiny.en',
        'tiny':                 'Systran/faster-whisper-tiny',
        'base.en':              'Systran/faster-whisper-base.en',
        'base':                 'Systran/faster-whisper-base',
        'small.en':             'Systran/faster-whisper-small.en',
        'small':                'Systran/faster-whisper-small',
        'medium.en':            'Systran/faster-whisper-medium.en',
        'medium':               'Systran/faster-whisper-medium',
        'large-v1':             'Systran/faster-whisper-large-v1',
        'large-v2':             'Systran/faster-whisper-large-v2',
        'large-v3':             'Systran/faster-whisper-large-v3',
        'large':                'Systran/faster-whisper-large-v3',
        'distil-large-v2':      'Systran/faster-distil-whisper-large-v2',
        'distil-large-v3':      'Systran/faster-distil-whisper-large-v3',
        'distil-medium.en':     'Systran/faster-distil-whisper-medium.en',
        'distil-small.en':      'Systran/faster-distil-whisper-small.en',
    }

    def _download_model(self, model_size: str) -> str:
        """下载 faster-whisper 模型，通过日志输出下载进度，返回模型本地路径。

        与 faster_whisper 不同，这里在初始化 WhisperModel 之前手动触发下载，
        以便将下载进度同时输出到控制台和日志文件。
        """
        from huggingface_hub import snapshot_download, try_to_load_from_cache

        # 将模型简称映射为 HuggingFace repo_id（与 faster_whisper 行为一致）
        repo_id = self._MODEL_REPOS.get(model_size, model_size)

        # 先检查核心文件 model.bin 是否已缓存
        cached = try_to_load_from_cache(repo_id, 'model.bin')
        if cached is not None:
            _logger.info(f'模型 {model_size} 已缓存 (repo: {repo_id})')
        else:
            _logger.info(f'模型 {model_size} 未缓存，开始从 {repo_id} 下载...')

        # snapshot_download 自带 tqdm 进度条（显示在控制台），同时缓存命中时立即返回
        local_path = snapshot_download(
            repo_id,
            allow_patterns=[
                'config.json',
                'tokenizer.json',
                'model.bin',
                'preprocessor_config.json',
            ],
        )

        if cached is None:
            _logger.info(f'模型 {model_size} 下载完成 (path: {local_path})')

        return local_path

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

        load_dotenv()

        # 先手动下载模型（带进度日志），再加载到 faster_whisper
        model_path = self._download_model(model_size)
        model = WhisperModel(model_path, device=device, compute_type=compute_type)
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
    _logger.info(f'SRT saved: {result.file_path}')
    _logger.info(f'Language: {result.language} ({result.language_probability:.4f})')
