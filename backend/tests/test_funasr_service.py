"""FunASR 集成测试

验证 FunASR 服务的基本功能：
- 服务初始化
- 模型预设配置
- VAD 开关
- SRT 输出格式
"""

import os
import sys
import tempfile
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from app.services.funasr_service import FunASRResult, FunASRService


class TestFunASRServiceInit:
    """测试 FunASR 服务初始化"""

    def test_service_init(self):
        service = FunASRService()
        assert service is not None

    def test_model_presets_with_vad(self):
        service = FunASRService()
        assert 'paraformer-zh' in service.MODEL_PRESETS
        preset = service.MODEL_PRESETS['paraformer-zh']
        assert preset['model'] == 'paraformer-zh'
        assert preset['vad_model'] == 'fsmn-vad'
        assert preset['punc_model'] == 'ct-punc'

    def test_model_presets_without_vad(self):
        service = FunASRService()
        assert 'paraformer-zh' in service.MODEL_PRESETS_NO_VAD
        preset = service.MODEL_PRESETS_NO_VAD['paraformer-zh']
        assert preset['model'] == 'paraformer-zh'
        assert preset['vad_model'] is None
        assert preset['punc_model'] == 'ct-punc'


class TestFunASRSrtFormatting:
    """测试 SRT 时间码格式化"""

    def test_format_srt_time(self):
        service = FunASRService()
        assert service._format_srt_time(0) == '00:00:00,000'
        assert service._format_srt_time(1.5) == '00:00:01,500'
        assert service._format_srt_time(61.234) == '00:01:01,234'
        assert service._format_srt_time(3661.1) == '01:01:01,100'

    def test_split_by_punctuation_basic(self):
        service = FunASRService()
        text = '你好世界，我是FunASR。'
        timestamps = [[0, 200], [200, 400], [400, 600], [600, 800],
                       [800, 1000], [1000, 1200], [1200, 1400], [1400, 1600],
                       [1600, 1800], [1800, 2000], [2000, 2200]]
        segments = service._split_by_punctuation(text, timestamps)
        # 应该按标点拆成两段
        assert len(segments) >= 2
        # 第一段应包含 "你好世界，"
        assert '你好世界' in segments[0][0]
        # 时间应该是递增的
        for i in range(1, len(segments)):
            assert segments[i][1] >= segments[i - 1][1]

    def test_split_by_punctuation_no_timestamps(self):
        service = FunASRService()
        text = '测试文本'
        segments = service._split_by_punctuation(text, [])
        assert len(segments) == 1
        assert segments[0] == ('测试文本', 0.0, 0.0)


class TestFunASROutputDir:
    """测试输出目录解析"""

    def test_resolve_output_dir_default(self):
        service = FunASRService()
        out_dir = service._resolve_output_dir()
        assert out_dir.exists()
        assert 'srt' in str(out_dir)

    def test_resolve_output_dir_custom(self):
        service = FunASRService()
        with tempfile.TemporaryDirectory() as tmpdir:
            out_dir = service._resolve_output_dir(tmpdir)
            assert out_dir == Path(tmpdir)

    def test_resolve_output_filename_with_id(self):
        service = FunASRService()
        name = service._resolve_output_filename('/tmp/test.wav', 'abc123')
        assert name.startswith('abc123_')
        assert name.endswith('.srt')

    def test_resolve_output_filename_custom(self):
        service = FunASRService()
        name = service._resolve_output_filename('/tmp/test.wav', 'abc123', 'custom.srt')
        assert name == 'abc123_custom.srt'


def _inject_mock_funasr(mock_auto_model):
    """往 sys.modules 注入 mock funasr，避免触发真实 torch 导入"""
    mock_funasr = MagicMock()
    mock_funasr.AutoModel = mock_auto_model
    sys.modules['funasr'] = mock_funasr
    return mock_funasr


class TestFunASRTranscribeMock:
    """测试 transcribe 方法（mock funasr 模型，无需 torch）"""

    def test_transcribe_with_vad(self):
        mock_model = MagicMock()
        mock_model.generate.return_value = [
            {
                'text': '你好世界',
                'timestamp': [[0, 200], [200, 400], [400, 600], [600, 800]],
            }
        ]
        mock_auto = MagicMock(return_value=mock_model)
        _inject_mock_funasr(mock_auto)

        try:
            service = FunASRService()
            with tempfile.TemporaryDirectory() as tmpdir:
                audio_path = os.path.join(tmpdir, 'test.wav')
                Path(audio_path).touch()

                result = service.transcribe(
                    input_file=audio_path,
                    file_id='test123',
                    model_name='paraformer-zh',
                    enable_vad=True,
                    output_path=tmpdir,
                    device='cpu',
                )

                assert isinstance(result, FunASRResult)
                assert result.language == 'zh'
                assert result.device == 'cpu'
                assert result.compute_type == 'funasr'
                assert '你好世界' in result.content
                assert result.file_path.exists()

                # 验证调用了 AutoModel 且 vad_model 被传入
                call_kwargs = mock_auto.call_args
                assert call_kwargs[1].get('vad_model') == 'fsmn-vad'
        finally:
            sys.modules.pop('funasr', None)

    def test_transcribe_without_vad(self):
        mock_model = MagicMock()
        mock_model.generate.return_value = [
            {
                'text': '测试无VAD',
                'timestamp': [[0, 300], [300, 600], [600, 900], [900, 1200]],
            }
        ]
        mock_auto = MagicMock(return_value=mock_model)
        _inject_mock_funasr(mock_auto)

        try:
            service = FunASRService()
            with tempfile.TemporaryDirectory() as tmpdir:
                audio_path = os.path.join(tmpdir, 'test.wav')
                Path(audio_path).touch()

                result = service.transcribe(
                    input_file=audio_path,
                    file_id='test456',
                    model_name='paraformer-zh',
                    enable_vad=False,
                    output_path=tmpdir,
                    device='cpu',
                )

                assert isinstance(result, FunASRResult)
                assert '测试无VAD' in result.content

                # 验证调用了 AutoModel 且没有 vad_model
                call_kwargs = mock_auto.call_args
                assert 'vad_model' not in call_kwargs[1]
        finally:
            sys.modules.pop('funasr', None)


class TestFunASRTranscribeRaw:
    """transcribe_raw：TTS 核对专用纯转写（不落 SRT 文件，复用模型缓存 + 推理锁）。"""

    def test_returns_concatenated_text_no_srt_file(self):
        mock_model = MagicMock()
        mock_model.generate.return_value = [
            {'text': '第一段文本。', 'timestamp': []},
            {'text': '第二段文本。', 'timestamp': []},
        ]
        mock_auto = MagicMock(return_value=mock_model)
        _inject_mock_funasr(mock_auto)

        try:
            service = FunASRService()
            FunASRService._model_cache.pop('paraformer-zh_False_cpu', None)
            try:
                with tempfile.TemporaryDirectory() as tmpdir:
                    audio_path = os.path.join(tmpdir, 'seg.mp3')
                    Path(audio_path).touch()

                    text = service.transcribe_raw(audio_path, device='cpu')

                    assert '第一段文本' in text
                    assert '第二段文本' in text
                    # 不写任何 SRT 文件
                    assert list(Path(tmpdir).iterdir()) == [Path(audio_path)]
                    # 无 VAD：AutoModel 不接收 vad_model
                    assert 'vad_model' not in mock_auto.call_args[1]
                    # batch_size_s=300 整段识别
                    assert mock_model.generate.call_args[1]['batch_size_s'] == 300
            finally:
                FunASRService._model_cache.pop('paraformer-zh_False_cpu', None)
        finally:
            sys.modules.pop('funasr', None)

    def test_reuses_no_vad_model_cache(self):
        """缓存 key 与 transcribe(enable_vad=False) 对齐，两条链路共享已加载模型。"""
        mock_model = MagicMock()
        mock_model.generate.return_value = [{'text': 'x', 'timestamp': []}]
        mock_auto = MagicMock(return_value=mock_model)
        _inject_mock_funasr(mock_auto)

        try:
            service = FunASRService()
            FunASRService._model_cache.pop('paraformer-zh_False_cpu', None)
            try:
                with tempfile.TemporaryDirectory() as tmpdir:
                    audio_path = os.path.join(tmpdir, 'a.wav')
                    Path(audio_path).touch()
                    service.transcribe_raw(audio_path, device='cpu')
                    service.transcribe_raw(audio_path, device='cpu')
            finally:
                FunASRService._model_cache.pop('paraformer-zh_False_cpu', None)
            # 只在首次实例化模型
            assert mock_auto.call_count == 1
        finally:
            sys.modules.pop('funasr', None)

    def test_holds_inference_lock(self):
        mock_model = MagicMock()
        lock_holder = {}

        def fake_generate(**kwargs):
            lock_holder['locked'] = FunASRService._inference_lock.locked()
            return [{'text': 'ok', 'timestamp': []}]

        mock_model.generate.side_effect = fake_generate
        mock_auto = MagicMock(return_value=mock_model)
        _inject_mock_funasr(mock_auto)

        try:
            service = FunASRService()
            with tempfile.TemporaryDirectory() as tmpdir:
                audio_path = os.path.join(tmpdir, 'a.wav')
                Path(audio_path).touch()
                text = service.transcribe_raw(audio_path, device='cpu')
            assert text == 'ok'
            assert lock_holder['locked'] is True
        finally:
            sys.modules.pop('funasr', None)

    def test_missing_funasr_package_raises_import_error(self):
        """funasr 未安装（workers 环境）→ ImportError 上抛，由 API 层转 503。"""
        saved = sys.modules.pop('funasr', None)
        sys.modules['funasr'] = None  # import funasr → ImportError
        try:
            service = FunASRService()
            with pytest.raises(ImportError):
                service.transcribe_raw('/tmp/x.wav', device='cpu')
        finally:
            if saved is not None:
                sys.modules['funasr'] = saved
            else:
                sys.modules.pop('funasr', None)
