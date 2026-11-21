"""HTTP client behavior: routing, error envelopes, auth header, transport failure."""
import httpx
import pytest

from narraforge_cli.client import Client
from narraforge_cli.config import Config
from narraforge_cli.errors import ApiError, BackendUnavailableError


def make_client(backend) -> Client:
    return Client(Config("http://test", None), transport=backend.transport)


class DownTransport(httpx.BaseTransport):
    def handle_request(self, request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused")


def test_health_and_capabilities(backend) -> None:
    client = make_client(backend)
    assert client.health() == {"status": "healthy", "app_env": "local"}
    assert client.capabilities()["deploy_target"] == "local"


def test_list_projects(backend) -> None:
    backend.route("GET", "/api/segmented-projects", 200, {"items": [{"id": "a", "name": "A"}]})
    assert make_client(backend).list_projects() == [{"id": "a", "name": "A"}]


def test_error_envelope_dict_detail(backend) -> None:
    backend.route(
        "GET",
        "/api/segmented-projects/nope",
        404,
        {"detail": {"code": "project_not_found", "message": "no such project"}},
    )
    with pytest.raises(ApiError) as ei:
        make_client(backend).get_project("nope")
    assert ei.value.status_code == 404
    assert ei.value.code == "project_not_found"
    assert ei.value.message == "no such project"


def test_error_envelope_string_detail(backend) -> None:
    backend.route("POST", "/api/segmented-projects", 409, {"detail": "project_already_exists"})
    with pytest.raises(ApiError) as ei:
        make_client(backend).create_project({"id": "x", "name": "n"})
    assert ei.value.code == "project_already_exists"
    assert ei.value.message == "project_already_exists"


def test_non_json_error_body() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, content=b"internal error")

    client = Client(Config("http://test", None), transport=httpx.MockTransport(handler))
    with pytest.raises(ApiError) as ei:
        client.get_project("x")
    assert ei.value.code == "error"


def test_transport_down_raises_unavailable() -> None:
    with pytest.raises(BackendUnavailableError):
        Client(Config("http://test", None), transport=DownTransport()).health()


def test_bearer_token_sent(backend) -> None:
    client = Client(Config("http://test", "tok123"), transport=backend.transport)
    client.health()
    auth = backend.calls[-1]["headers"].get("authorization")
    assert auth == "Bearer tok123"
