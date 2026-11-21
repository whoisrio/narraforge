"""project export command: path patching, configs merge, scaffold variant."""
import json

from narraforge_cli.main import app


def make_detail() -> dict:
    return {
        "id": "p1",
        "name": "Demo",
        "remotion_project_path": None,
        "configs": {"description": "keep me", "split_voice_mode": "narration"},
        "chapters": [],
    }


def test_export_plain_with_path_and_dir(runner, backend) -> None:
    backend.route("GET", "/api/segmented-projects/p1", 200, make_detail())
    backend.route_fn(
        "PATCH",
        lambda path, payload: path == "/api/segmented-projects/p1",
        200,
        {**make_detail(), "remotion_project_path": "/tmp/prj"},
    )
    backend.route(
        "POST",
        "/api/segmented-projects/p1/export-all-chapters",
        200,
        {
            "exported": [
                {
                    "chapter_id": "c1",
                    "title": "第一章",
                    "audio_path": "/tmp/prj/public/audio/第一章.mp3",
                    "srt_path": "/tmp/prj/public/audio/第一章.srt",
                }
            ],
            "count": 1,
        },
    )
    result = runner.invoke(
        app,
        [
            "--json",
            "project",
            "export",
            "p1",
            "--remotion-path",
            "/tmp/prj",
            "--export-dir",
            "public/audio",
        ],
    )
    assert result.exit_code == 0, result.output
    data = json.loads(result.stdout)
    assert data["count"] == 1 and data["exported"][0]["audio_path"].endswith("第一章.mp3")
    patch = backend.calls_for("PATCH", "/api/segmented-projects/p1")[0]["json"]
    # configs bucket is replaced wholesale by the backend: the CLI merged client-side
    assert patch["configs"] == {
        "description": "keep me",
        "split_voice_mode": "narration",
        "export_directory": "public/audio",
    }
    assert patch["remotion_project_path"] == "/tmp/prj"


def test_export_without_any_config_fails_409(runner, backend) -> None:
    detail = make_detail()
    detail["configs"] = {}
    backend.route("GET", "/api/segmented-projects/p1", 200, detail)
    backend.route(
        "POST",
        "/api/segmented-projects/p1/export-all-chapters",
        409,
        {"detail": {"code": "export_directory_not_configured", "message": "no export dir"}},
    )
    result = runner.invoke(app, ["--json", "project", "export", "p1"])
    assert result.exit_code == 1
    assert "export_directory_not_configured" in result.stderr


def test_export_scaffold_uses_remotion_path(runner, backend) -> None:
    backend.route("GET", "/api/segmented-projects/p1", 200, make_detail())
    backend.route_fn(
        "PATCH", lambda path, payload: path == "/api/segmented-projects/p1", 200, make_detail()
    )
    backend.route(
        "POST",
        "/api/segmented-projects/p1/scaffold-remotion",
        200,
        {"project_dir": "/tmp/prj", "created": True, "chapters": 2},
    )
    result = runner.invoke(
        app, ["--json", "project", "export", "p1", "--remotion-path", "/tmp/prj", "--scaffold"]
    )
    assert result.exit_code == 0, result.output
    data = json.loads(result.stdout)
    assert data == {"project_dir": "/tmp/prj", "created": True, "chapters": 2}
    scaffold = backend.calls_for("POST", "/api/segmented-projects/p1/scaffold-remotion")[0]["json"]
    assert scaffold == {"target_dir": "/tmp/prj"}
    # plain export endpoint must NOT have been called
    assert backend.calls_for("POST", "/api/segmented-projects/p1/export-all-chapters") == []


def test_export_scaffold_without_prior_patch(runner, backend) -> None:
    backend.route("GET", "/api/segmented-projects/p1", 200, make_detail())
    backend.route(
        "POST",
        "/api/segmented-projects/p1/scaffold-remotion",
        200,
        {"project_dir": "/global/root/Demo", "created": False, "chapters": 1},
    )
    result = runner.invoke(app, ["--json", "project", "export", "p1", "--scaffold"])
    assert result.exit_code == 0, result.output
    scaffold = backend.calls_for("POST", "/api/segmented-projects/p1/scaffold-remotion")[0]["json"]
    assert scaffold == {"target_dir": None}  # backend falls back to project/global settings


def test_export_no_patch_needed_when_no_options(runner, backend) -> None:
    detail = make_detail()
    detail["remotion_project_path"] = "/already/set"
    detail["configs"] = {"export_directory": "public/audio"}
    backend.route("GET", "/api/segmented-projects/p1", 200, detail)
    backend.route(
        "POST",
        "/api/segmented-projects/p1/export-all-chapters",
        200,
        {"exported": [], "count": 0},
    )
    result = runner.invoke(app, ["--json", "project", "export", "p1"])
    assert result.exit_code == 0, result.output
    assert backend.calls_for("PATCH", "/api/segmented-projects/p1") == []  # no PATCH issued
