import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch, Mock
from pathlib import Path

from main import app

client = TestClient(app)


def test_transcribe_success(sample_audio_file, mock_voice_to_srt):
    """测试语音转字幕成功"""
    with open(sample_audio_file, 'rb') as f:
        response = client.post(
            "/api/speech-to-text/transcribe",
            files={"file": ("test.wav", f, "audio/wav")},
            data={"model_size": "tiny", "beam_size": "1"},
        )
    assert response.status_code == 200
    data = response.json()
    assert "file_id" in data
    assert "content" in data
    assert "filename" in data
    assert "language" in data
    assert "language_probability" in data
    assert "download_url" in data
    assert data["download_url"].startswith("/api/speech-to-text/download/")


def test_transcribe_unsupported_format():
    """测试上传不支持的文件格式"""
    response = client.post(
        "/api/speech-to-text/transcribe",
        files={"file": ("test.txt", b"hello", "text/plain")},
    )
    assert response.status_code == 400


def test_download_not_found():
    """测试下载不存在的文件"""
    response = client.get("/api/speech-to-text/download/nonexistent-id")
    assert response.status_code == 404
