"""Tests for the kv split_chapters node (rule split -> LLM review)."""
import pytest

from app.nodes.knowledge_video.split_chapters import (
    rule_split_narration_script,
    split_chapters_node,
)
from app.schemas import (
    ChapterStructure,
    ChapterWithSegmentIds,
    Segment,
    SegmentChapters,
    SegmentWithId,
)


# ---------------------------------------------------------------------------
# rule_split_narration_script — pure local prep step (no LLM)
# ---------------------------------------------------------------------------


def test_rule_split_produces_chapters_split_on_punct():
    script = "# 第一章\n你好，世界。今天天气不错！\n\n## 第二章\n这是第二章的内容；很短。"
    result = rule_split_narration_script(script)

    assert [ch.chapter_title for ch in result.chapters] == ["第一章", "第二章"]
    # 第一章按 ，。！ 切成 3 段（含尾部标点）
    seg_texts = [s.text for s in result.chapters[0].segments]
    assert seg_texts == ["你好，", "世界。", "今天天气不错！"]
    # 每段默认 emotion=neutral, role=narration
    assert result.chapters[0].segments[0].emotion == "neutral"
    assert result.chapters[0].segments[0].role == "narration"
    assert result.chapters[0].segments[0].segment_kind == "narration"


def test_rule_split_uses_chinese_bracket_markers():
    """gen_narration 有时输出 【章节：xxx】 而非 markdown 标题。"""
    script = "【章节：引言】\n第一句。第二句。\n【章节：正文】\n正文一。"
    result = rule_split_narration_script(script)
    titles = [ch.chapter_title for ch in result.chapters]
    assert titles == ["引言", "正文"]


def test_rule_split_skips_empty_chapters():
    script = "# 空章节\n\n# 有内容\n有一句话。"
    result = rule_split_narration_script(script)
    titles = [ch.chapter_title for ch in result.chapters]
    # 空章节保留（后续 batch_create 需要它），但 segments 为空是允许的
    assert "有内容" in titles


# ---------------------------------------------------------------------------
# split_chapters_node — rule split + LLM review
# ---------------------------------------------------------------------------


class _FakeBackend:
    def __init__(self, ids):
        self._ids = ids
        self.calls = []

    async def batch_create_structure(
        self, pid, structure, narration_scripts=None, engine=None, full_script=None
    ):
        self.calls.append((pid, structure, narration_scripts, engine, full_script))
        return self._ids


class _FakeRuntime:
    def __init__(self, backend):
        self.store = None
        self.backend = backend


def _patch(monkeypatch, review_structure, capture=None):
    monkeypatch.setattr(
        "app.nodes.knowledge_video.split_chapters.get_stream_writer",
        lambda: (lambda p: None),
    )

    async def fake_structured(schema, messages, **kw):
        if capture is not None:
            capture["messages"] = messages
            capture["schema"] = schema
        return review_structure, None

    monkeypatch.setattr(
        "app.nodes.knowledge_video.split_chapters.structured_llm",
        fake_structured,
    )
    monkeypatch.setattr(
        "app.nodes.knowledge_video.split_chapters.knowledge_video.get_prompt",
        lambda name, **kw: f"PROMPT::{name}",
    )


@pytest.mark.asyncio
async def test_uses_rule_split_then_calls_review_llm(monkeypatch):
    """节点应先做规则切分，然后把粗分结果作为 review 的输入喂给 LLM。"""
    review = SegmentChapters(
        chapters=[
            ChapterStructure(
                chapter_title="第一章",
                segments=[Segment(text="你好，世界。", emotion="happy")],
            )
        ]
    )
    capture: dict = {}
    _patch(monkeypatch, review, capture)
    backend = _FakeBackend(
        [ChapterWithSegmentIds(id="ch1", segments=[SegmentWithId(id="s1")])]
    )
    state = {
        "project_id": "p1",
        "narration_script": "# 第一章\n你好，世界。",
        "edited_script": "# 第一章\n你好，世界。",
    }
    result = await split_chapters_node(state, _FakeRuntime(backend))

    # LLM 收到的应该是 kv_split_review 的 system + 粗分的章节结构
    system_msg = capture["messages"][0]["content"]
    assert "kv_split_review" in system_msg
    user_msg = capture["messages"][1]["content"]
    assert "第一章" in user_msg
    # 粗分应该按标点切开；user_msg 中应包含至少一个粗分段
    assert "你好，" in user_msg

    # 节点应把 LLM review 结果落库
    assert result["error"] is None
    assert result["current_stage"] == "synthesis"
    assert result["structured_segments"][0]["_chapter_id"] == "ch1"
    assert result["structured_segments"][0]["segments"][0]["_segment_id"] == "s1"


@pytest.mark.asyncio
async def test_falls_back_to_rule_split_when_llm_returns_empty(monkeypatch):
    """LLM review 输出为空/无章节时，退化为原始规则切分结果，不阻塞流程。"""
    empty_review = SegmentChapters(chapters=[])
    _patch(monkeypatch, empty_review)
    backend = _FakeBackend(
        [ChapterWithSegmentIds(id="ch1", segments=[SegmentWithId(id="s1")])]
    )
    state = {
        "project_id": "p1",
        "narration_script": "# 唯一章节\n你好，世界。",
    }
    result = await split_chapters_node(state, _FakeRuntime(backend))
    assert result["error"] is None
    # 落库的是规则切分产物
    _, submitted, _, _, _ = backend.calls[0]
    assert submitted.chapters[0].chapter_title == "唯一章节"
    assert len(submitted.chapters[0].segments) >= 1


@pytest.mark.asyncio
async def test_falls_back_when_llm_alters_text(monkeypatch):
    """LLM 若改字（拼接后与原文不同），必须回退到规则切分结果，避免破坏原文。"""
    tampered = SegmentChapters(
        chapters=[
            ChapterStructure(
                chapter_title="第一章",
                segments=[Segment(text="您好，世界。")],  # LLM 把"你"改成"您"
            )
        ]
    )
    _patch(monkeypatch, tampered)
    backend = _FakeBackend(
        [ChapterWithSegmentIds(id="ch1", segments=[SegmentWithId(id="s1")])]
    )
    state = {
        "project_id": "p1",
        "narration_script": "# 第一章\n你好，世界。",
    }
    result = await split_chapters_node(state, _FakeRuntime(backend))
    assert result["error"] is None
    _, submitted, _, _, _ = backend.calls[0]
    # 落库文本必须来自原文（"你好" 而不是"您好"）
    joined = "".join(s.text for ch in submitted.chapters for s in ch.segments)
    assert "你好" in joined
    assert "您好" not in joined


@pytest.mark.asyncio
async def test_backend_failure_is_soft_error(monkeypatch):
    review = SegmentChapters(
        chapters=[ChapterStructure(chapter_title="c", segments=[Segment(text="t")])]
    )
    _patch(monkeypatch, review)

    class _BadBackend:
        async def batch_create_structure(self, *a, **kw):
            raise RuntimeError("backend down")

    state = {"project_id": "p1", "narration_script": "# c\nt。"}
    result = await split_chapters_node(state, _FakeRuntime(_BadBackend()))
    assert result["error"] is not None
    assert result["structured_segments"] == []


@pytest.mark.asyncio
async def test_voxcpm_engine_injects_tag_whitelist_in_user_msg(monkeypatch):
    review = SegmentChapters(
        chapters=[ChapterStructure(chapter_title="c", segments=[Segment(text="t。")])]
    )
    capture: dict = {}
    _patch(monkeypatch, review, capture)
    backend = _FakeBackend(
        [ChapterWithSegmentIds(id="ch1", segments=[SegmentWithId(id="s1")])]
    )
    state = {
        "project_id": "p1",
        "narration_script": "# c\nt。",
        "tts_engine": "voxcpm",
    }
    await split_chapters_node(state, _FakeRuntime(backend))
    user_msg = capture["messages"][1]["content"]
    assert "[laughing]" in user_msg
    _, _, _, engine, _fs = backend.calls[0]
    assert engine == "voxcpm"


@pytest.mark.asyncio
async def test_non_voxcpm_engine_forbids_tags_in_user_msg(monkeypatch):
    review = SegmentChapters(
        chapters=[ChapterStructure(chapter_title="c", segments=[Segment(text="t。")])]
    )
    capture: dict = {}
    _patch(monkeypatch, review, capture)
    backend = _FakeBackend(
        [ChapterWithSegmentIds(id="ch1", segments=[SegmentWithId(id="s1")])]
    )
    state = {
        "project_id": "p1",
        "narration_script": "# c\nt。",
        "tts_engine": "mimo_tts",
    }
    await split_chapters_node(state, _FakeRuntime(backend))
    user_msg = capture["messages"][1]["content"]
    assert "不要插入" in user_msg
    _, _, _, engine, _fs = backend.calls[0]
    assert engine == "mimo_tts"
