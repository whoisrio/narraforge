"""Pure segment status helpers."""
from narraforge_cli.segments import list_rows, plan_segments, segment_ready, summarize


def seg(sid: str, *, current=None, text="hello", position=0) -> dict:  # noqa: ANN001
    return {
        "id": sid,
        "position": position,
        "text": text,
        "audio": {"current": current} if current is not None else None,
    }


def detail(*chapters: dict) -> dict:  # noqa: ANN001
    return {"chapters": list(chapters)}


def chapter(cid: str, name: str, *segments: dict) -> dict:  # noqa: ANN001
    return {"id": cid, "name": name, "segments": list(segments)}


def test_segment_ready_variants() -> None:
    assert segment_ready(seg("a", current={"path": "x.mp3", "file_exists": True}))
    assert segment_ready(seg("a", current={"path": "x.mp3"}))  # absent file_exists = assume ok
    assert not segment_ready(seg("a", current={"path": "x.mp3", "file_exists": False}))
    assert not segment_ready(seg("a", current=None))
    assert not segment_ready({"id": "a", "text": "t", "audio": None})


def test_list_rows_filtering() -> None:
    d = detail(
        chapter(
            "c1",
            "一",
            seg("s1", current={"path": "a.mp3"}, position=0),
            seg("s2", position=1),
        ),
        chapter("c2", "二", seg("s3", position=0)),
    )
    rows = list_rows(d)
    assert [r["segment_id"] for r in rows] == ["s1", "s2", "s3"]
    assert rows[0]["origin"] is None and rows[0]["ready"] is True
    only_c2 = list_rows(d, chapter_id="c2")
    assert [r["segment_id"] for r in only_c2] == ["s3"]
    missing = list_rows(d, missing_only=True)
    assert [r["segment_id"] for r in missing] == ["s2", "s3"]


def test_plan_segments_keeps_recorded_flag() -> None:
    recorded = seg("r1", current={"path": "a.mp3", "origin": "recorded"})
    d = detail(chapter("c1", "一", seg("s1", position=0), recorded, seg("s2", position=2)))
    plan = plan_segments(d)
    assert [p["segment_id"] for p in plan] == ["s1", "r1", "s2"]
    assert [p["origin"] for p in plan] == [None, "recorded", None]
    assert plan_segments(d, segment_id="r1")[0]["segment_id"] == "r1"


def test_summarize_counts() -> None:
    results = [{"status": "ok"}, {"status": "ok"}, {"status": "failed"}, {"status": "skipped"}]
    assert summarize(results) == {"ok": 2, "failed": 1, "skipped": 1}
