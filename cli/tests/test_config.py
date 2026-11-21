"""Env-driven config resolution."""
from narraforge_cli.config import load_config


def test_defaults(monkeypatch) -> None:
    monkeypatch.delenv("NARRAFORGE_API_URL", raising=False)
    monkeypatch.delenv("NARRAFORGE_API_TOKEN", raising=False)
    cfg = load_config()
    assert cfg.api_url == "http://127.0.0.1:8002"
    assert cfg.token is None


def test_env_values_and_trailing_slash(monkeypatch) -> None:
    monkeypatch.setenv("NARRAFORGE_API_URL", "http://example.com:9000/")
    monkeypatch.setenv("NARRAFORGE_API_TOKEN", "tok")
    cfg = load_config()
    assert cfg.api_url == "http://example.com:9000"
    assert cfg.token == "tok"


def test_explicit_override_wins(monkeypatch) -> None:
    monkeypatch.setenv("NARRAFORGE_API_URL", "http://env.example.com")
    cfg = load_config("http://flag.example.com/")
    assert cfg.api_url == "http://flag.example.com"
