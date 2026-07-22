from app.services.srt_service import build_srt


def test_build_srt_accumulates_timestamps():
    segments = [
        {"text": "第一段", "duration_sec": 2.5},
        {"text": "第二段", "duration_sec": 1.5},
    ]
    srt = build_srt(segments)
    blocks = srt.strip().split("\n\n")
    assert blocks[0] == "1\n00:00:00,000 --> 00:00:02,500\n第一段"
    assert blocks[1] == "2\n00:00:02,500 --> 00:00:04,000\n第二段"


def test_build_srt_with_offset():
    segments = [{"text": "x", "duration_sec": 1.0}]
    srt = build_srt(segments, offset_sec=3.0)
    assert "00:00:03,000 --> 00:00:04,000" in srt


def test_build_srt_missing_duration_treated_as_zero():
    segments = [{"text": "a"}, {"text": "b", "duration_sec": 1.0}]
    srt = build_srt(segments)
    assert "00:00:00,000 --> 00:00:00,000" in srt
    assert "00:00:00,000 --> 00:00:01,000" in srt


def test_build_srt_hours_and_millis():
    segments = [{"text": "x", "duration_sec": 3661.007}]
    srt = build_srt(segments)
    assert "00:00:00,000 --> 01:01:01,007" in srt


def test_build_srt_strips_style_tags():
    segments = [
        {"text": "(开心,磁性)你好[笑]世界", "duration_sec": 1.0},
        {"text": "（悲伤）他走了[叹气]。", "duration_sec": 1.0},
    ]
    srt = build_srt(segments)
    blocks = srt.strip().split("\n\n")
    assert blocks[0].endswith("\n你好世界")
    assert blocks[1].endswith("\n他走了。")
