"""project synthesize command: sequential loop, skip semantics, failure exit code."""
import json

from narraforge_cli.main import app


def make_detail() -> dict:
    return {
        "id": "p1",
        "name": "Demo",
        "configs": {},
        "chapters": [
            {
                "id": "c1",
                "name": "第一章",
                "voice": {"engine": "edge_tts"},
                "segments": [
                    {"id": "s1", "position": 0, "text": "第一句。", "audio": None},
                    {
                        "id": "s2",
                        "position": 1,
                        "text": "第二句。",
                        "audio": {
                            "current": {
                                "path": "a.mp3",
                                "origin": "recorded",
                                "file_exists": True,
                            }
                        },
                    },
                    {"id": "s3", "position": 2, "text": "   ", "audio": None},
                    {"id": "s4", "position": 3, "text": "第四句。", "audio": None},
                ],
            }
        ],
    }


def test_synthesize_skips_recorded_and_empty(runner, backend) -> None:
    backend.route("GET", "/api/segmented-projects/p1", 200, make_detail())
    backend.route_fn(
        "POST",
        lambda path, payload: path.endswith("/synthesize"),
        200,
        {"chapters": []},
    )
    result = runner.invoke(app, ["--json", "project", "synthesize", "p1"])
    assert result.exit_code == 0, result.output
    data = json.loads(result.stdout)
    assert data["summary"] == {"ok": 2, "failed": 0, "skipped": 2}
    statuses = {r["segment_id"]: r["status"] for r in data["results"]}
    assert statuses["s2"] == "skipped" and statuses["s3"] == "skipped"
    called = [c for c in backend.calls if c["path"].endswith("/synthesize")]
    assert len(called) == 2  # s1 + s4 only
    assert called[0]["json"] == {"force": False}


def test_synthesize_force_includes_recorded(runner, backend) -> None:
    backend.route("GET", "/api/segmented-projects/p1", 200, make_detail())
    backend.route_fn(
        "POST", lambda path, payload: path.endswith("/synthesize"), 200, {"chapters": []}
    )
    result = runner.invoke(app, ["--json", "project", "synthesize", "p1", "--force"])
    assert result.exit_code == 0, result.output
    called = [c for c in backend.calls if c["path"].endswith("/synthesize")]
    assert len(called) == 3  # s1, s2 (forced), s4
    assert all(c["json"] == {"force": True} for c in called)
    skipped = [r for r in json.loads(result.stdout)["results"] if r["status"] == "skipped"]
    assert [r["segment_id"] for r in skipped] == ["s3"]  # only empty text skipped


def test_synthesize_segment_filter(runner, backend) -> None:
    backend.route("GET", "/api/segmented-projects/p1", 200, make_detail())
    backend.route_fn(
        "POST", lambda path, payload: path.endswith("/synthesize"), 200, {"chapters": []}
    )
    result = runner.invoke(app, ["--json", "project", "synthesize", "p1", "--segment", "s4"])
    assert result.exit_code == 0, result.output
    called = [c for c in backend.calls if c["path"].endswith("/synthesize")]
    assert len(called) == 1
    assert "/chapters/c1/segments/s4/synthesize" in called[0]["path"]


def test_synthesize_chapter_filter(runner, backend) -> None:
    detail = make_detail()
    detail["chapters"].append(
        {
            "id": "c2",
            "name": "第二章",
            "voice": {"engine": "edge_tts"},
            "segments": [{"id": "s5", "position": 0, "text": "第五句。", "audio": None}],
        }
    )
    backend.route("GET", "/api/segmented-projects/p1", 200, detail)
    backend.route_fn(
        "POST", lambda path, payload: path.endswith("/synthesize"), 200, {"chapters": []}
    )
    result = runner.invoke(app, ["--json", "project", "synthesize", "p1", "--chapter", "c2"])
    assert result.exit_code == 0, result.output
    called = [c for c in backend.calls if c["path"].endswith("/synthesize")]
    assert len(called) == 1
    assert "/chapters/c2/segments/s5/synthesize" in called[0]["path"]


def test_synthesize_failure_exit_1_and_stop_on_error(runner, backend) -> None:
    detail = make_detail()
    detail["chapters"][0]["segments"] = [
        {"id": "s1", "position": 0, "text": "会失败。", "audio": None},
        {"id": "s2", "position": 1, "text": "第二句。", "audio": None},
    ]
    backend.route("GET", "/api/segmented-projects/p1", 200, detail)
    backend.route(
        "POST",
        "/api/segmented-projects/p1/chapters/c1/segments/s1/synthesize",
        500,
        {"detail": {"code": "tts_failed", "message": "engine exploded"}},
    )
    backend.route_fn(
        "POST", lambda path, payload: path.endswith("/synthesize"), 200, {"chapters": []}
    )
    result = runner.invoke(app, ["--json", "project", "synthesize", "p1"])
    assert result.exit_code == 1
    data = json.loads(result.stdout)
    assert data["summary"]["failed"] == 1 and data["summary"]["ok"] == 1
    failed = [r for r in data["results"] if r["status"] == "failed"][0]
    assert failed["error"] == "engine exploded"

    result2 = runner.invoke(app, ["--json", "project", "synthesize", "p1", "--stop-on-error"])
    assert result2.exit_code == 1
    called = [c for c in backend.calls if c["path"].endswith("/synthesize")]
    calls_before = 2  # first invoke attempted s1 (failed) + s2 (ok)
    assert len(called) - calls_before == 1  # stopped after the first failure
