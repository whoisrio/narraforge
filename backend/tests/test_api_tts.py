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
