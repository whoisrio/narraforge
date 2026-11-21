"""project split command: orchestration across markdown-split + chapters:batch."""
import json

from narraforge_cli.main import app

NARRATION = "## 第一章\n第一段内容。\n\n## 第二章\n第二段内容。"


def make_detail() -> dict:
    return {
        "id": "p1",
        "name": "Demo",
        "narration_script": NARRATION,
        "configs": {},
        "chapters": [],
    }


def test_split_rule_mode_end_to_end(runner, backend) -> None:
    backend.route("GET", "/api/segmented-projects/p1", 200, make_detail())
    backend.route(
        "POST",
        "/api/text-split/markdown-detect",
        200,
        {"doc_title": "演示", "candidates": [{"level": 2}, {"level": 2}], "total_chars": 30},
    )
    backend.route(
        "POST",
        "/api/text-split/markdown-split",
        200,
        {
            "doc_title": "演示",
            "chapters": [
                {
                    "title": "第一章",
                    "level": 2,
                    "start_char": 0,
                    "end_char": NARRATION.index("## 第二章"),
                },
                {
                    "title": "第二章",
                    "level": 2,
                    "start_char": NARRATION.index("## 第二章"),
                    "end_char": len(NARRATION),
                },
            ],
        },
    )
    backend.route_fn(
        "POST",
        lambda path, payload: path.endswith("/chapters:batch"),
        200,
        {"chapters": [{"id": "c1", "segments": [{"id": "s1"}, {"id": "s2"}]}], "reuse": None},
    )
    result = runner.invoke(app, ["--json", "project", "split", "p1"])
    assert result.exit_code == 0, result.output
    data = json.loads(result.stdout)
    assert data["chapters"] == 1 and data["segments"] == 2

    detect = backend.calls_for("POST", "/api/text-split/markdown-detect")[0]["json"]
    assert detect["text"] == NARRATION and detect["front_matter_mode"] == "skip"
    split = backend.calls_for("POST", "/api/text-split/markdown-split")[0]["json"]
    assert split["levels"] == [2]  # auto-picked: 2 candidates at level 2
    batch = [c for c in backend.calls if c["path"].endswith("/chapters:batch")][0]["json"]
    assert batch["split_segments"] is True
    assert batch["narration_script"] == NARRATION
    assert [c["chapter_title"] for c in batch["chapters"]] == ["第一章", "第二章"]
    assert batch["chapters"][0]["narration_script"] == "第一段内容。"
    assert batch["chapters"][0]["original_text"] == "第一段内容。"
    assert "engine" not in batch["chapters"][0]


def test_split_explicit_levels_and_engine(runner, backend) -> None:
    backend.route("GET", "/api/segmented-projects/p1", 200, make_detail())
    backend.route(
        "POST",
        "/api/text-split/markdown-detect",
        200,
        {"doc_title": "演示", "candidates": [{"level": 2}, {"level": 3}]},
    )
    backend.route(
        "POST",
        "/api/text-split/markdown-split",
        200,
        {
            "doc_title": "演示",
            "chapters": [{"title": "第一章", "start_char": 0, "end_char": len(NARRATION)}],
        },
    )
    backend.route_fn(
        "POST",
        lambda path, payload: path.endswith("/chapters:batch"),
        200,
        {"chapters": [{"id": "c1", "segments": []}], "reuse": None},
    )
    result = runner.invoke(
        app, ["--json", "project", "split", "p1", "--levels", "3", "--engine", "edge_tts"]
    )
    assert result.exit_code == 0, result.output
    split = backend.calls_for("POST", "/api/text-split/markdown-split")[0]["json"]
    assert split["levels"] == [3]
    batch = [c for c in backend.calls if c["path"].endswith("/chapters:batch")][0]["json"]
    assert batch["chapters"][0]["engine"] == "edge_tts"


def test_split_llm_mode_calls_llm_per_chapter(runner, backend) -> None:
    backend.route("GET", "/api/segmented-projects/p1", 200, make_detail())
    backend.route(
        "POST",
        "/api/text-split/markdown-detect",
        200,
        {"doc_title": "演示", "candidates": [{"level": 2}, {"level": 2}]},
    )
    backend.route(
        "POST",
        "/api/text-split/markdown-split",
        200,
        {
            "doc_title": "演示",
            "chapters": [
                {"title": "第一章", "start_char": 0, "end_char": NARRATION.index("## 第二章")},
                {
                    "title": "第二章",
                    "start_char": NARRATION.index("## 第二章"),
                    "end_char": len(NARRATION),
                },
            ],
        },
    )
    backend.route(
        "POST",
        "/api/text-split/llm",
        200,
        {"segments": [{"text": "第一段内容。", "reason": "r", "emotion": "neutral"}]},
    )
    backend.route_fn(
        "POST",
        lambda path, payload: path.endswith("/chapters:batch"),
        200,
        {"chapters": [{"id": "c1", "segments": []}], "reuse": None},
    )
    result = runner.invoke(app, ["--json", "project", "split", "p1", "--mode", "llm"])
    assert result.exit_code == 0, result.output
    llm_calls = backend.calls_for("POST", "/api/text-split/llm")
    assert len(llm_calls) == 2  # one per chapter body
    batch = [c for c in backend.calls if c["path"].endswith("/chapters:batch")][0]["json"]
    assert batch["split_segments"] is False
    assert batch["chapters"][0]["segments"] == [{"text": "第一段内容。", "emotion": "neutral"}]


def test_split_no_headings_single_chapter(runner, backend) -> None:
    plain = make_detail()
    plain["narration_script"] = "没有标题的普通文稿。"
    backend.route("GET", "/api/segmented-projects/p1", 200, plain)
    backend.route(
        "POST",
        "/api/text-split/markdown-detect",
        200,
        {"doc_title": "普通文稿", "candidates": []},
    )
    backend.route_fn(
        "POST",
        lambda path, payload: path.endswith("/chapters:batch"),
        200,
        {"chapters": [{"id": "c1", "segments": []}], "reuse": None},
    )
    result = runner.invoke(app, ["--json", "project", "split", "p1"])
    assert result.exit_code == 0, result.output
    batch = [c for c in backend.calls if c["path"].endswith("/chapters:batch")][0]["json"]
    assert len(batch["chapters"]) == 1
    assert batch["chapters"][0]["chapter_title"] == "普通文稿"
    assert batch["chapters"][0]["narration_script"] == "没有标题的普通文稿。"
    assert backend.calls_for("POST", "/api/text-split/markdown-split") == []


def test_split_dry_run_and_preserve_audio(runner, backend) -> None:
    backend.route("GET", "/api/segmented-projects/p1", 200, make_detail())
    backend.route(
        "POST",
        "/api/text-split/markdown-detect",
        200,
        {"doc_title": "演示", "candidates": [{"level": 2}, {"level": 2}]},
    )
    backend.route(
        "POST",
        "/api/text-split/markdown-split",
        200,
        {
            "doc_title": "演示",
            "chapters": [
                {"title": "第一章", "start_char": 0, "end_char": NARRATION.index("## 第二章")},
                {
                    "title": "第二章",
                    "start_char": NARRATION.index("## 第二章"),
                    "end_char": len(NARRATION),
                },
            ],
        },
    )
    backend.route_fn(
        "POST",
        lambda path, payload: path.endswith("/chapters:batch"),
        200,
        {"chapters": [], "reuse": {"chapters_matched": 2, "segments_reused": 4}},
    )
    result = runner.invoke(
        app, ["--json", "project", "split", "p1", "--dry-run", "--preserve-audio"]
    )
    assert result.exit_code == 0, result.output
    data = json.loads(result.stdout)
    assert data["dry_run"] is True
    assert data["reuse"]["segments_reused"] == 4
    batch = [c for c in backend.calls if c["path"].endswith("/chapters:batch")][0]["json"]
    assert batch["dry_run"] is True and batch["preserve_audio"] is True


def test_split_without_script_fails(runner, backend) -> None:
    backend.route(
        "GET",
        "/api/segmented-projects/p1",
        200,
        {"id": "p1", "name": "Demo", "narration_script": None, "configs": {}, "chapters": []},
    )
    result = runner.invoke(app, ["--json", "project", "split", "p1"])
    assert result.exit_code == 1
    assert "no narration script" in result.stderr


def test_split_unknown_engine_fails(runner, backend) -> None:
    backend.route("GET", "/api/segmented-projects/p1", 200, make_detail())
    result = runner.invoke(app, ["--json", "project", "split", "p1", "--engine", "cosyvoice"])
    assert result.exit_code == 1
    assert "unknown engine" in result.stderr
