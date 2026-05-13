import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch

from main import app

client = TestClient(app)


def test_list_default_voices():
    """测试获取默认声音列表"""
    response = client.get("/api/tts/voices")
    assert response.status_code == 200
    data = response.json()
    assert "voices" in data
    assert len(data["voices"]) > 0
    assert any(v["id"] == "xiaoyun" for v in data["voices"])


def test_list_edge_voices(client, mock_edge_tts_service):
    """测试获取 Edge-TTS 音色列表"""
    response = client.get("/api/tts/edge-voices")
    assert response.status_code == 200
    data = response.json()
    assert "voices" in data
    assert len(data["voices"]) == 2
    assert data["voices"][0]["short_name"] == "zh-CN-XiaoxiaoNeural"


def test_list_edge_voices_with_filter(client, mock_edge_tts_service):
    """测试按语言筛选 Edge-TTS 音色"""
    response = client.get("/api/tts/edge-voices?language=Chinese")
    assert response.status_code == 200
    mock_edge_tts_service.list_voices.assert_called_with(language="Chinese", gender=None)


def test_list_edge_languages(client, mock_edge_tts_service):
    """测试获取 Edge-TTS 语言列表"""
    response = client.get("/api/tts/edge-languages")
    assert response.status_code == 200
    data = response.json()
    assert "languages" in data
    assert "Chinese" in data["languages"]


def test_synthesize_with_edge_tts(client, mock_edge_tts_service, db_session):
    """测试使用 Edge-TTS 引擎合成语音"""
    response = client.post("/api/tts/synthesize", json={
        "text": "Hello world",
        "engine": "edge_tts",
        "edge_voice": "en-US-GuyNeural",
        "edge_rate": "+0%",
        "edge_volume": "+0%",
    })
    assert response.status_code == 200
    data = response.json()
    assert "audio_id" in data
    assert data["params"]["engine"] == "edge_tts"
    assert data["params"]["edge_voice"] == "en-US-GuyNeural"


def test_synthesize_edge_tts_missing_voice(client, mock_edge_tts_service, db_session):
    """测试 Edge-TTS 缺少 voice 参数时返回 400"""
    response = client.post("/api/tts/synthesize", json={
        "text": "Hello world",
        "engine": "edge_tts",
    })
    assert response.status_code == 400
