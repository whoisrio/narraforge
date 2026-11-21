"""project set-engine command."""
import json

from narraforge_cli.main import app
from tests.conftest import make_project_detail


def make_detail_with_chapters() -> dict:
    detail = make_project_detail()
    detail["chapters"] = [
        {"id": "ch-1", "name": "第一章", "voice": {"engine": "edge_tts"}, "segments": []},
        {"id": "ch-2", "name": "第二章", "voice": None, "segments": []},
    ]
    return detail


def test_set_engine_all_chapters(runner, backend) -> None:
    backend.route("GET", "/api/segmented-projects/p1", 200, make_detail_with_chapters())
    backend.route_fn(
        "PATCH",
        lambda path, payload: "/chapters/" in path,
        200,
        {"chapter": {}, "project_updated_at": "t"},
    )
    result = runner.invoke(
        app, ["--json", "project", "set-engine", "p1", "mimo_tts", "--param", "voice_id=preset-7"]
    )
    assert result.exit_code == 0, result.output
    data = json.loads(result.stdout)
    assert data["voice"] == {"engine": "mimo_tts", "mode": "preset", "voice_id": "preset-7"}
    calls = [c for c in backend.calls if c["method"] == "PATCH" and "/chapters/" in c["path"]]
    assert len(calls) == 2
    assert calls[0]["json"] == {
        "voice": {"engine": "mimo_tts", "mode": "preset", "voice_id": "preset-7"}
    }


def test_set_engine_single_chapter(runner, backend) -> None:
    backend.route("GET", "/api/segmented-projects/p1", 200, make_detail_with_chapters())
    backend.route_fn(
        "PATCH", lambda path, payload: path.endswith("/chapters/ch-2"), 200, {"chapter": {}}
    )
    result = runner.invoke(
        app, ["--json", "project", "set-engine", "p1", "edge_tts", "--chapter", "ch-2"]
    )
    assert result.exit_code == 0, result.output
    calls = [c for c in backend.calls if c["method"] == "PATCH" and "/chapters/" in c["path"]]
    assert len(calls) == 1
    assert calls[0]["json"] == {"voice": {"engine": "edge_tts"}}


def test_set_engine_unknown_engine_fails(runner, backend) -> None:
    backend.route("GET", "/api/segmented-projects/p1", 200, make_detail_with_chapters())
    result = runner.invoke(app, ["--json", "project", "set-engine", "p1", "cosyvoice"])
    assert result.exit_code == 1
    assert "unknown engine" in result.stderr


def test_set_engine_bad_param_fails(runner, backend) -> None:
    backend.route("GET", "/api/segmented-projects/p1", 200, make_detail_with_chapters())
    result = runner.invoke(
        app, ["--json", "project", "set-engine", "p1", "edge_tts", "--param", "voice"]
    )
    assert result.exit_code == 1
    assert "key=value" in result.stderr


def test_set_engine_no_matching_chapter_fails(runner, backend) -> None:
    backend.route("GET", "/api/segmented-projects/p1", 200, make_detail_with_chapters())
    result = runner.invoke(
        app, ["--json", "project", "set-engine", "p1", "edge_tts", "--chapter", "nope"]
    )
    assert result.exit_code == 1
    assert "no matching chapters" in result.stderr
