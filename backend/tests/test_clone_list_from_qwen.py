"""A2 regression test: /clone/list-from-qwen must not NameError on undefined db."""
from unittest.mock import AsyncMock


def test_list_from_qwen_returns_voices(client, monkeypatch):
    class FakeService:
        async def list_cloned_voices(self):
            return [{"voice_id": "qv1", "name": "n", "status": "OK"}]

    monkeypatch.setattr("app.api.clone.get_tts_service", AsyncMock(return_value=FakeService()))
    resp = client.get("/api/clone/list-from-qwen")
    assert resp.status_code == 200
    assert resp.json()["items"][0]["voice_id"] == "qv1"
