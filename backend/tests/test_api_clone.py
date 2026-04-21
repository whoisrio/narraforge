import pytest
from fastapi.testclient import TestClient
from io import BytesIO


def test_upload_voice(client: TestClient):
    """测试上传音频文件"""
    audio_data = BytesIO(b"fake audio data")
    files = {"file": ("test.mp3", audio_data, "audio/mpeg")}

    response = client.post("/api/clone/upload", files=files)
    assert response.status_code == 200
    data = response.json()
    assert "id" in data
    assert "name" in data
    assert "audio_url" in data
