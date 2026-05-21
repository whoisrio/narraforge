from fastapi.testclient import TestClient
from unittest.mock import patch, Mock

from main import app


def test_transcribe_success(client, sample_audio_file, mock_voice_to_srt):
    """测试语音转字幕成功"""
    with open(sample_audio_file, "rb") as f:
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


def test_transcribe_unsupported_format(client):
    """测试上传不支持的文件格式"""
    response = client.post(
        "/api/speech-to-text/transcribe",
        files={"file": ("test.txt", b"hello", "text/plain")},
    )
    assert response.status_code == 400


def test_download_not_found(client):
    """测试下载不存在的文件"""
    response = client.get("/api/speech-to-text/download/nonexistent-id")
    assert response.status_code == 404


def test_history_empty_initially(client, mock_voice_to_srt):
    """测试初始状态下历史记录为空"""
    response = client.get("/api/speech-to-text/history")
    assert response.status_code == 200
    assert response.json() == {"results": []}


def test_transcribe_creates_history_record(client, mock_voice_to_srt, sample_audio_file):
    """测试转录成功后创建历史记录"""
    with open(sample_audio_file, "rb") as f:
        response = client.post(
            "/api/speech-to-text/transcribe",
            files={"file": ("test.wav", f, "audio/wav")},
            data={"model_size": "large-v3", "beam_size": "5"},
        )
    assert response.status_code == 200

    response = client.get("/api/speech-to-text/history")
    assert response.status_code == 200
    results = response.json()["results"]
    assert len(results) == 1
    record = results[0]
    assert record["original_filename"] == "test.wav"
    assert record["language"] == "en"
    assert record["model_size"] == "large-v3"


def test_delete_history_record(client, mock_voice_to_srt, sample_audio_file):
    """测试删除历史记录"""
    with open(sample_audio_file, "rb") as f:
        response = client.post(
            "/api/speech-to-text/transcribe",
            files={"file": ("test.wav", f, "audio/wav")},
            data={"model_size": "large-v3", "beam_size": "5"},
        )
    assert response.status_code == 200

    response = client.get("/api/speech-to-text/history")
    record_id = response.json()["results"][0]["id"]

    response = client.delete(f"/api/speech-to-text/history/{record_id}")
    assert response.status_code == 200

    response = client.get("/api/speech-to-text/history")
    assert response.json()["results"] == []


def test_delete_nonexistent_record(client, mock_voice_to_srt):
    """测试删除不存在的历史记录"""
    response = client.delete("/api/speech-to-text/history/nonexistent-id")
    assert response.status_code == 404


def test_history_limit_enforced(client, mock_voice_to_srt, sample_audio_file):
    """测试历史记录数量限制为10条"""
    for _ in range(11):
        with open(sample_audio_file, "rb") as f:
            response = client.post(
                "/api/speech-to-text/transcribe",
                files={"file": ("test.wav", f, "audio/wav")},
                data={"model_size": "large-v3", "beam_size": "5"},
            )
        assert response.status_code == 200

    response = client.get("/api/speech-to-text/history")
    assert response.status_code == 200
    results = response.json()["results"]
    assert len(results) == 10
