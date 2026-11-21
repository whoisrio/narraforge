"""project list/get/create commands."""
import json

import httpx

from narraforge_cli.main import app
from tests.conftest import make_project_detail


def test_project_list_json(runner, backend) -> None:
    backend.route(
        "GET",
        "/api/segmented-projects",
        200,
        {
            "items": [
                {"id": "p1", "name": "One", "updated_at": "2026-11-21T00:00:00"},
                {"id": "p2", "name": "Two", "updated_at": "2026-11-20T00:00:00"},
            ]
        },
    )
    result = runner.invoke(app, ["--json", "project", "list"])
    assert result.exit_code == 0
    data = json.loads(result.stdout)
    assert [p["id"] for p in data["items"]] == ["p1", "p2"]


def test_project_get_json(runner, backend) -> None:
    backend.route("GET", "/api/segmented-projects/p1", 200, make_project_detail())
    result = runner.invoke(app, ["--json", "project", "get", "p1"])
    assert result.exit_code == 0
    assert json.loads(result.stdout)["id"] == "proj-1"  # the canned detail's id


def test_project_create_with_script(tmp_path, runner, backend) -> None:
    script = tmp_path / "narration.md"
    script.write_text("# 标题\n\n第一段。第二段。", encoding="utf-8")
    detail = make_project_detail()
    backend.route_fn(
        "POST",
        lambda path, payload: path == "/api/segmented-projects" and isinstance(payload, dict),
        201,
        detail,
    )
    backend.route_fn(
        "PUT",
        lambda path, payload: path.endswith("/narration-script"),
        200,
        {"path": "narration.md", "project_updated_at": "2026-11-21T00:00:01"},
    )
    backend.route_fn(
        "PATCH",
        # /api/segmented-projects/{id} has exactly 3 slashes (vs 5 for chapter PATCH)
        lambda path, payload: path.startswith("/api/segmented-projects/") and path.count("/") == 3,
        200,
        detail,
    )
    result = runner.invoke(
        app,
        [
            "--json",
            "project",
            "create",
            "--name",
            "Demo",
            "--script",
            str(script),
            "--remotion-path",
            "/tmp/remotion-prj",
        ],
    )
    assert result.exit_code == 0, result.output
    data = json.loads(result.stdout)
    posted = backend.calls_for("POST", "/api/segmented-projects")[0]["json"]
    assert data["id"] == posted["id"]  # client generates the UUID and echoes it
    assert posted["schema_version"] == 2
    assert posted["name"] == "Demo"
    put = [
        c for c in backend.calls if c["method"] == "PUT" and c["path"].endswith("/narration-script")
    ][0]
    assert put["json"]["text"].startswith("# 标题")
    patch = [c for c in backend.calls if c["method"] == "PATCH" and c["path"].count("/") == 3][0]
    assert patch["json"] == {"remotion_project_path": "/tmp/remotion-prj"}


def test_project_create_api_error_exit_1(runner, backend) -> None:
    backend.route("POST", "/api/segmented-projects", 409, {"detail": "project_already_exists"})
    result = runner.invoke(app, ["--json", "project", "create", "--name", "Dup"])
    assert result.exit_code == 1
    assert "project_already_exists" in result.stderr


def test_project_list_human(runner, backend) -> None:
    backend.route(
        "GET",
        "/api/segmented-projects",
        200,
        {"items": [{"id": "p1", "name": "One", "updated_at": "2026-11-21T00:00:00"}]},
    )
    result = runner.invoke(app, ["project", "list"])
    assert result.exit_code == 0
    assert "p1" in result.output and "One" in result.output


def test_project_get_not_found_exit_1(runner, backend) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, json={"detail": "project_not_found"})

    backend.transport = httpx.MockTransport(handler)
    result = runner.invoke(app, ["--json", "project", "get", "missing"])
    assert result.exit_code == 1
    assert "project_not_found" in result.stderr
