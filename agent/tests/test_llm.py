import instructor
from instructor import Mode

from app.llm import get_instructor_client


def test_instructor_client_dashscope_json(monkeypatch):
    monkeypatch.setenv("AGENT_LLM_API_KEY", "k")
    monkeypatch.setenv("AGENT_LLM_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1")
    monkeypatch.setenv("AGENT_LLM_MODEL", "qwen-plus")
    client, model = get_instructor_client()
    assert isinstance(client, instructor.AsyncInstructor)
    assert model == "qwen-plus"


def test_instructor_client_mimo_md_json(monkeypatch):
    monkeypatch.setenv("AGENT_LLM_API_KEY", "k")
    monkeypatch.setenv("AGENT_LLM_BASE_URL", "https://api.xiaomimimo.com/v1")
    monkeypatch.setenv("AGENT_LLM_MODEL", "mimo-1")
    client, model = get_instructor_client()
    assert isinstance(client, instructor.AsyncInstructor)
    assert model == "mimo-1"
    # MiMo uses MD_JSON mode; the underlying openai client carries the api-key header
    raw = client.client
    assert raw.default_headers.get("api-key") == "k"
