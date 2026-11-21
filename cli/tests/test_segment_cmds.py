"""segment list + project status commands."""
import json

from narraforge_cli.main import app


def make_detail() -> dict:
    return {
        "id": "p1",
        "name": "Demo",
        "remotion_project_path": "/tmp/remotion-prj",
        "configs": {"export_directory": "public/audio"},
        "chapters": [
            {
                "id": "c1",
                "name": "第一章",
                "voice": {"engine": "mimo_tts"},
                "segments": [
                    {
                        "id": "s1",
                        "position": 0,
                        "text": "第一句。",
                        "audio": {
                            "current": {"path": "a.mp3", "file_exists": True, "origin": "tts"}
                        },
                    },
                    {
                        "id": "s2",
                        "position": 1,
                        "text": "第二句。",
                        "audio": None,
                    },
                ],
            }
        ],
    }


def test_segment_list_json(runner, backend) -> None:
    backend.route("GET", "/api/segmented-projects/p1", 200, make_detail())
    result = runner.invoke(app, ["--json", "segment", "list", "p1"])
    assert result.exit_code == 0, result.output
    data = json.loads(result.output)
    assert data["count"] == 2
    assert [r["segment_id"] for r in data["items"]] == ["s1", "s2"]
    assert data["items"][0]["ready"] is True and data["items"][1]["ready"] is False


def test_segment_list_missing_only(runner, backend) -> None:
    backend.route("GET", "/api/segmented-projects/p1", 200, make_detail())
    result = runner.invoke(app, ["--json", "segment", "list", "p1", "--missing-only"])
    assert result.exit_code == 0
    assert [r["segment_id"] for r in json.loads(result.output)["items"]] == ["s2"]


def test_project_status_json(runner, backend) -> None:
    backend.route("GET", "/api/segmented-projects/p1", 200, make_detail())
    result = runner.invoke(app, ["--json", "project", "status", "p1"])
    assert result.exit_code == 0, result.output
    data = json.loads(result.output)
    assert data["all_ready"] is False
    assert data["chapters"][0]["ready"] == 1 and data["chapters"][0]["total"] == 2
    assert data["chapters"][0]["missing_segment_ids"] == ["s2"]
    assert data["chapters"][0]["engine"] == "mimo_tts"
    assert data["remotion_project_path"] == "/tmp/remotion-prj"
    assert data["export_directory"] == "public/audio"


def test_project_status_human(runner, backend) -> None:
    backend.route("GET", "/api/segmented-projects/p1", 200, make_detail())
    result = runner.invoke(app, ["project", "status", "p1"])
    assert result.exit_code == 0
    assert "Demo" in result.output
    assert "1/2 ready" in result.output
