"""FunASR 本地语音识别服务

使用 FunASR 的 Paraformer 模型进行中文语音识别，自带 VAD + 标点恢复。
相比 Whisper，中文识别速度更快、准确率更高。
"""

import logging
import os
import re
import uuid
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

_logger = logging.getLogger('funasr_service')

# 复用 voice_to_srt_service 的字幕拆分逻辑
from app.services.voice_to_srt_service import split_segment_to_entries


@dataclass
class FunASRResult:
    """FunASR 识别结果，与 SrtResult 结构兼容"""
    file_path: Path
    content: str
    filename: str
    language: str
    language_probability: float
    device: str = 'cpu'
    compute_type: str = 'funasr'


class FunASRService:
    """FunASR 本地语音转字幕服务"""

    # FunASR 支持的模型组合
    MODEL_PRESETS = {
        'paraformer-zh': {
            'model': 'paraformer-zh',
            'vad_model': 'fsmn-vad',
            'punc_model': 'ct-punc',
        },
        'paraformer-zh-streaming': {
            'model': 'paraformer-zh-streaming',
            'vad_model': 'fsmn-vad',
            'punc_model': 'ct-punc',
        },
    }

    # 不带 VAD 的预设（直接识别整段音频）
    MODEL_PRESETS_NO_VAD = {
        'paraformer-zh': {
            'model': 'paraformer-zh',
            'vad_model': None,
            'punc_model': 'ct-punc',
        },
        'paraformer-zh-streaming': {
            'model': 'paraformer-zh-streaming',
            'vad_model': None,
            'punc_model': 'ct-punc',
        },
    }

    def _resolve_output_dir(self, output_path: str | None = None) -> Path:
        if output_path:
            p = Path(output_path)
        else:
            env_dir = os.getenv('OUTPUT_DIR')
            if env_dir:
                p = Path(env_dir)
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

    def _detect_device(self) -> str:
        """检测可用设备：cuda > mps > cpu"""
        try:
            import torch
            if torch.cuda.is_available():
                _logger.info('FunASR: 检测到 CUDA GPU')
                return 'cuda'
            if hasattr(torch.backends, 'mps') and torch.backends.mps.is_available():
                _logger.info('FunASR: 检测到 Apple MPS')
                return 'mps'
        except ImportError:
            pass
        _logger.info('FunASR: 使用 CPU')
        return 'cpu'

    def transcribe(
        self,
        input_file: str,
        file_id: str,
        model_name: str = 'paraformer-zh',
        enable_vad: bool = True,
        output_filename: str | None = None,
        output_path: str | None = None,
        device: str | None = None,
    ) -> FunASRResult:
        """
        使用 FunASR 识别语音并生成 SRT 字幕。

        Args:
            input_file: 音频文件路径
            file_id: 唯一标识
            model_name: FunASR 模型名（paraformer-zh / paraformer-zh-streaming）
            output_filename: 自定义输出文件名
            output_path: 自定义输出目录
            device: 推理设备（默认自动检测）

        Returns:
            FunASRResult
        """
        from funasr import AutoModel

        if device is None:
            device = self._detect_device()

        presets = self.MODEL_PRESETS if enable_vad else self.MODEL_PRESETS_NO_VAD
        preset = presets.get(model_name, presets['paraformer-zh'])
        vad_info = f", vad={preset['vad_model']}" if preset.get('vad_model') else ", vad=off"
        _logger.info(f'FunASR 加载模型: {model_name}, device={device}{vad_info}')

        model_kwargs = {
            'model': preset['model'],
            'punc_model': preset['punc_model'],
            'device': device,
        }
        if preset.get('vad_model'):
            model_kwargs['vad_model'] = preset['vad_model']

        model = AutoModel(**model_kwargs)

        _logger.info(f'FunASR 开始识别: {input_file}')
        results = model.generate(input=input_file, batch_size_s=300)

        # 解析 FunASR 结果，提取带时间戳的片段
        srt_entries: list[tuple[str, float, float]] = []

        for result in results:
            text = result.get('text', '').strip()
            if not text:
                continue

            # FunASR 返回的 timestamp 是字级别时间戳 [(start_ms, end_ms), ...]
            timestamps = result.get('timestamp', [])

            if timestamps and len(timestamps) > 0:
                # 有字级别时间戳：按标点拆分后精确分配时间
                # 先用标点拆分文本
                segments = self._split_by_punctuation(text, timestamps)
                for seg_text, seg_start, seg_end in segments:
                    # 再按 max_chars 拆分长段
                    sub_entries = split_segment_to_entries(seg_text, seg_start, seg_end)
                    srt_entries.extend(sub_entries)
            else:
                # 无时间戳：整段作为一条，时间设为 0
                srt_entries.append((text, 0.0, 0.0))

        # 构建 SRT 内容
        lines = []
        for i, (text, start, end) in enumerate(srt_entries, start=1):
            lines.append(str(i))
            lines.append(f'{self._format_srt_time(start)} --> {self._format_srt_time(end)}')
            lines.append(text)
            lines.append('')

        content = '\n'.join(lines)

        # 保存文件
        out_dir = self._resolve_output_dir(output_path)
        filename = self._resolve_output_filename(input_file, file_id, output_filename)
        out_file = out_dir / filename

        with open(out_file, 'w', encoding='utf-8') as f:
            f.write(content)

        _logger.info(f'FunASR 识别完成: {out_file}')

        return FunASRResult(
            file_path=out_file,
            content=content,
            filename=filename,
            language='zh',
            language_probability=0.95,  # FunASR Paraformer 默认中文
            device=device,
            compute_type='funasr',
        )

    def _split_by_punctuation(
        self, text: str, timestamps: list[list[int]]
    ) -> list[tuple[str, float, float]]:
        """
        根据标点符号将文本拆分成段落，利用字级别时间戳分配时间。

        FunASR 的 timestamp 数量可能少于文本字符数（VAD 截断或模型省略），
        超出 timestamp 范围的字符使用最后一个已知时间戳的 end 值。

        Args:
            text: 完整识别文本
            timestamps: FunASR 返回的字级别时间戳 [[start_ms, end_ms], ...]

        Returns:
            [(segment_text, start_sec, end_sec), ...]
        """
        if not timestamps:
            return [(text, 0.0, 0.0)]

        punct_pattern = re.compile(r'[，。；！？、,;!?]')
        last_end_ms = timestamps[-1][1]  # 用于超出范围时的兜底

        segments = []
        current_text = []
        current_start_ms = timestamps[0][0] if timestamps else 0
        char_idx = 0

        for i, ch in enumerate(text):
            current_text.append(ch)

            # 获取当前字符的时间戳，超出范围则用最后一个
            if char_idx < len(timestamps):
                end_ms = timestamps[char_idx][1]
            else:
                end_ms = last_end_ms

            # 如果是标点或者是最后一个字符，切分一段
            if punct_pattern.match(ch) or i == len(text) - 1:
                seg_text = ''.join(current_text).strip()
                if seg_text:
                    start_sec = current_start_ms / 1000.0
                    end_sec = end_ms / 1000.0
                    # 确保 end > start（至少 0.1s）
                    if end_sec <= start_sec:
                        end_sec = start_sec + 0.1
                    segments.append((seg_text, start_sec, end_sec))
                current_text = []
                if i < len(text) - 1:
                    # 下一段的起始时间
                    next_idx = char_idx + 1
                    if next_idx < len(timestamps):
                        current_start_ms = timestamps[next_idx][0]
                    else:
                        # timestamps 用完了，从上一段的实际 end 开始
                        current_start_ms = int(end_sec * 1000)

            # 计数所有有意义的字符（与 FunASR 的 timestamp 索引一致）
            # FunASR 对中英文字符和标点都生成 timestamp，只跳过空格
            if ch != ' ':
                char_idx += 1

        # 处理残留
        remaining = ''.join(current_text).strip()
        if remaining:
            if timestamps:
                start_sec = timestamps[max(0, min(char_idx, len(timestamps) - 1))][0] / 1000.0
                end_sec = last_end_ms / 1000.0
            else:
                start_sec = 0.0
                end_sec = 0.0
            segments.append((remaining, start_sec, end_sec))

        return segments if segments else [(text, 0.0, 0.0)]


if __name__ == '__main__':
    import argparse

    parser = argparse.ArgumentParser(description='FunASR 语音转 SRT 字幕')
    parser.add_argument('input_file', help='输入音频文件路径')
    parser.add_argument('-o', '--output-filename', default=None)
    parser.add_argument('-p', '--output-path', default=None)
    parser.add_argument('-m', '--model', default='paraformer-zh', help='FunASR 模型名')
    parser.add_argument('-d', '--device', default=None)

    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO)
    service = FunASRService()
    result = service.transcribe(
        input_file=args.input_file,
        file_id=str(uuid.uuid4()),
        model_name=args.model,
        output_filename=args.output_filename,
        output_path=args.output_path,
        device=args.device,
    )
    print(f'SRT saved: {result.file_path}')
    print(f'Language: {result.language} ({result.language_probability})')
