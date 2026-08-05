"""Regression tests for STT engine fixes (2026-08-05):

1. Whisper: `_download_model` 的 allow_patterns 曾漏掉 vocabulary 文件，
   导致新下载的模型（缓存未命中）被 ctranslate2 拒绝：
   "Cannot load the vocabulary from the model directory"。
   只有 5 月缓存的 large-v3（含 vocabulary.json）能用，其余模型全挂。
2. FunASR: paraformer-zh-streaming 是流式模型，离线 generate 不产生有效
   时间戳且文本错乱（全部 00:00:00,000 + 重复字），不应作为离线转写选项。
"""
from unittest.mock import patch

import pytest

from app.services.voice_to_srt_service import VoiceToSrt


def test_whisper_download_includes_vocabulary_files():
    """snapshot_download 必须包含 vocabulary 文件，否则 ctranslate2 无法加载模型。"""
    captured = {}

    def fake_snapshot_download(repo_id, allow_patterns=None, **kwargs):
        captured['repo_id'] = repo_id
        captured['allow_patterns'] = allow_patterns
        return '/fake/model/dir'

    with patch('huggingface_hub.snapshot_download', side_effect=fake_snapshot_download), \
         patch('huggingface_hub.try_to_load_from_cache', return_value='/fake/model.bin'):
        VoiceToSrt()._download_model('tiny')

    patterns = captured['allow_patterns']
    assert 'vocabulary.json' in patterns
    assert 'vocabulary.txt' in patterns
    # 原有文件不回归
    assert 'model.bin' in patterns
    assert 'tokenizer.json' in patterns
    assert 'config.json' in patterns


def test_funasr_streaming_model_not_offered_for_offline():
    """流式模型不应出现在离线转写预设与 API 允许列表中。"""
    from app.services.funasr_service import FunASRService
    from app.api.speech_to_text import FUNASR_MODELS

    assert 'paraformer-zh-streaming' not in FunASRService.MODEL_PRESETS
    assert 'paraformer-zh-streaming' not in FunASRService.MODEL_PRESETS_NO_VAD
    assert 'paraformer-zh-streaming' not in FUNASR_MODELS
    assert 'paraformer-zh' in FUNASR_MODELS


@pytest.mark.parametrize('model_size', ['paraformer-zh-streaming'])
def test_transcribe_rejects_streaming_funasr_model(client, model_size):
    """API 层拒绝流式模型（400）。"""
    import io
    resp = client.post(
        '/api/speech-to-text/transcribe',
        files={'file': ('a.mp3', io.BytesIO(b'fake'), 'audio/mpeg')},
        data={'engine': 'funasr', 'model_size': model_size},
    )
    assert resp.status_code == 400
