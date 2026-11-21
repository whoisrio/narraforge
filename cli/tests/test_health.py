"""`nf health` output contract."""
import json

from typer.testing import CliRunner

import narraforge_cli.main as main_module
from narraforge_cli.main import app


def test_health_json(runner) -> None:
    result = runner.invoke(app, ["--json", "health"])
    assert result.exit_code == 0
    data = json.loads(result.output)
    assert data["health"]["status"] == "healthy"
    assert data["capabilities"]["deploy_target"] == "local"


def test_health_human(runner) -> None:
    result = runner.invoke(app, ["health"])
    assert result.exit_code == 0
    assert "backend: healthy" in result.output
    assert "deploy_target: local" in result.output
    assert "warning" not in result.stderr


def test_health_human_warns_when_storage_disabled(backend, runner) -> None:
    backend.route(
        "GET",
        "/api/config/capabilities",
        200,
        {"deploy_target": "local", "engines": ["edge_tts"], "features": {"backend_storage": False}},
    )
    result = runner.invoke(app, ["health"])
    assert result.exit_code == 0
    assert "warning: backend storage disabled" in result.stderr


def test_backend_unreachable_exit_2(monkeypatch) -> None:
    import httpx as _httpx

    from narraforge_cli.client import Client
    from narraforge_cli.config import Config

    def handler(request: _httpx.Request) -> _httpx.Response:
        raise _httpx.ConnectError("connection refused")

    def factory(config: Config) -> Client:
        return Client(config, transport=_httpx.MockTransport(handler))

    monkeypatch.setattr(main_module, "Client", factory)
    result = CliRunner().invoke(app, ["--json", "health"])
    assert result.exit_code == 2
    assert "cannot reach NarraForge backend" in result.stderr
