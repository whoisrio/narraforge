"""A8: verify that all HTTPException responses are wrapped in {detail: {code, message}} format.

The custom exception handler in main.py converts HTTPException responses to a
structured dict inside the `detail` envelope (matching FastAPI convention).
Machine codes (snake_case) become both `code` and `message`;
sentences/exceptions get a status-derived `code` and the original string as `message`.
"""
from fastapi import HTTPException
from fastapi.testclient import TestClient


def test_machine_code_error_returns_structured_format(client: TestClient):
    """Machine code details should have code == message inside detail."""
    resp = client.get("/api/segmented-projects/nonexistent-id")
    assert resp.status_code == 404
    data = resp.json()
    assert data["detail"]["code"] == "project_not_found"
    assert data["detail"]["message"] == "project_not_found"


def test_sentence_error_returns_structured_format(client: TestClient):
    """Non-machine-code details should have status-derived code and original message."""
    resp = client.post("/api/tts/synthesize", json={"text": "hi"})
    assert resp.status_code == 400
    data = resp.json()
    assert data["detail"]["code"] == "http_400"
    assert data["detail"]["message"] == "voice_id is required"


def test_non_machine_code_error_gets_status_derived_code(client: TestClient):
    """Non-machine-code details (sentences) get code = 'http_{status}' and the original string as message."""
    resp = client.get("/api/clone/nonexistent-voice-id")
    assert resp.status_code == 404
    data = resp.json()
    assert data["detail"]["code"] == "http_404"
    assert data["detail"]["message"] == "Voice not found"


def test_validation_error_returns_structured_format(client: TestClient):
    """Pydantic validation errors should also use the {detail: {code, message}}
    envelope. The status may be 400 (manual check) or 422 (Pydantic).
    """
    # Send a request with wrong types to trigger validation
    resp = client.post("/api/tts/synthesize", json={})
    assert resp.status_code in (400, 422)
    data = resp.json()
    assert "detail" in data
    assert "code" in data["detail"]
    assert "message" in data["detail"]


def test_health_endpoint_unaffected(client: TestClient):
    """Normal (non-error) responses should be unaffected by the handler."""
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "healthy"
