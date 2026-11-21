"""Pure split orchestration helpers."""
import pytest

from narraforge_cli.splitting import (
    DEFAULT_DELIMITERS,
    build_batch_payload,
    pick_markdown_level,
    slice_chapter_bodies,
)


def test_pick_markdown_level_most_frequent() -> None:
    detect = {"candidates": [{"level": 2}, {"level": 3}, {"level": 3}, {"level": 3}]}
    assert pick_markdown_level(detect) == [3]


def test_pick_markdown_level_tie_prefers_shallower() -> None:
    detect = {"candidates": [{"level": 2}, {"level": 3}, {"level": 2}, {"level": 3}]}
    assert pick_markdown_level(detect) == [2]


def test_pick_markdown_level_no_headings() -> None:
    assert pick_markdown_level({"candidates": []}) == []


def test_slice_chapter_bodies_strips_heading() -> None:
    text = "## 第一章\n第一节内容。\n\n## 第二章\n第二节内容。"
    c1_end = text.index("## 第二章")
    chapters = [
        {"title": "第一章", "start_char": 0, "end_char": c1_end},
        {"title": "第二章", "start_char": c1_end, "end_char": len(text)},
    ]
    bodies = slice_chapter_bodies(text, chapters)
    assert bodies[0] == {"title": "第一章", "body": "第一节内容。"}
    assert bodies[1] == {"title": "第二章", "body": "第二节内容。"}


def test_slice_chapter_bodies_no_heading_line() -> None:
    chapters = [{"title": "全文", "start_char": 0, "end_char": 6}]
    assert slice_chapter_bodies("直接开始", chapters) == [{"title": "全文", "body": "直接开始"}]


def test_build_batch_payload_rule_mode() -> None:
    bodies = [{"title": "第一章", "body": "正文。"}]
    payload = build_batch_payload(
        bodies,
        full_text="全文",
        engine="mimo_tts",
        mode="rule",
        preserve_audio=True,
        dry_run=False,
    )
    assert payload["split_segments"] is True
    assert payload["preserve_audio"] is True
    assert payload["dry_run"] is False
    assert payload["narration_script"] == "全文"
    ch = payload["chapters"][0]
    assert ch["chapter_title"] == "第一章"
    assert ch["narration_script"] == "正文。"
    assert ch["original_text"] == "正文。"
    assert ch["engine"] == "mimo_tts"
    assert ch["split_config"] == {"mode": "rule", "delimiters": DEFAULT_DELIMITERS}
    assert "segments" not in ch


def test_build_batch_payload_llm_mode_injects_segments() -> None:
    bodies = [{"title": "第一章", "body": "正文。"}]
    llm_segments = [[{"text": "正文。", "emotion": "neutral"}]]
    payload = build_batch_payload(
        bodies,
        full_text="全文",
        engine=None,
        mode="llm",
        preserve_audio=False,
        dry_run=True,
        llm_segments=llm_segments,
    )
    assert payload["split_segments"] is False
    assert payload["dry_run"] is True
    assert payload["chapters"][0]["segments"] == [{"text": "正文。", "emotion": "neutral"}]
    assert "engine" not in payload["chapters"][0]


def test_default_delimiters_cover_cjk_and_latin() -> None:
    assert "。" in DEFAULT_DELIMITERS and "." in DEFAULT_DELIMITERS


def test_llm_mode_requires_llm_segments() -> None:
    bodies = [{"title": "第一章", "body": "正文。"}]
    with pytest.raises(ValueError):
        build_batch_payload(
            bodies,
            full_text="全文",
            engine=None,
            mode="llm",
            preserve_audio=False,
            dry_run=False,
            llm_segments=None,
        )
