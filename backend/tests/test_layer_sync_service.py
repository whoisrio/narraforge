"""Tests for layer_sync_service (Phase A: staleness detection + baselines)."""
from types import SimpleNamespace

from app.services.layer_sync_service import (
    hash_text,
    segments_hash,
    sync_status,
    mark_l2_derived,
    mark_split,
    mark_consistent,
)


def _chapter(original="", script="", segs=None, sync_state=None):
    return SimpleNamespace(
        original_text=original,
        narration_script=script,
        segments=[SimpleNamespace(text=t) for t in (segs or [])],
        sync_state=sync_state,
    )


# ── hash stability ──


def test_hash_text_stable_and_sensitive():
    assert hash_text("abc") == hash_text("abc")
    assert hash_text("abc") != hash_text("abd")
    assert hash_text("") == hash_text("")  # empty stable
    assert hash_text(None) == hash_text("")  # None tolerated


def test_segments_hash_changes_when_segment_text_changes():
    ch = _chapter(segs=["a", "b"])
    h1 = segments_hash(ch.segments)
    ch2 = _chapter(segs=["a", "c"])
    assert segments_hash(ch2.segments) != h1


def test_segments_hash_empty_stable():
    assert segments_hash([]) == segments_hash([])


# ── sync_status ──


def test_sync_status_no_state_all_false():
    ch = _chapter(original="x", script="y", segs=["z"])
    assert sync_status(ch) == {"l1_dirty": False, "l2_dirty": False, "l3_dirty": False}


def test_sync_status_consistent_all_false():
    ch = _chapter(original="o", script="s", segs=["t"])
    mark_consistent(ch)
    assert sync_status(ch) == {"l1_dirty": False, "l2_dirty": False, "l3_dirty": False}


def test_sync_status_l1_dirty_when_original_changed():
    ch = _chapter(original="o", script="s", segs=["t"])
    mark_consistent(ch)
    ch.original_text = "o-changed"
    st = sync_status(ch)
    assert st["l1_dirty"] is True
    assert st["l2_dirty"] is False
    assert st["l3_dirty"] is False


def test_sync_status_l2_dirty_when_script_changed():
    ch = _chapter(original="o", script="s", segs=["t"])
    mark_consistent(ch)
    ch.narration_script = "s-changed"
    st = sync_status(ch)
    assert st["l1_dirty"] is False
    assert st["l2_dirty"] is True
    assert st["l3_dirty"] is False


def test_sync_status_l3_dirty_when_segment_changed():
    ch = _chapter(original="o", script="s", segs=["t"])
    mark_consistent(ch)
    ch.segments[0].text = "t-changed"
    st = sync_status(ch)
    assert st["l1_dirty"] is False
    assert st["l2_dirty"] is False
    assert st["l3_dirty"] is True


def test_sync_status_all_dirty_after_changing_all_layers():
    ch = _chapter(original="o", script="s", segs=["t"])
    mark_consistent(ch)
    ch.original_text = "o2"
    ch.narration_script = "s2"
    ch.segments[0].text = "t2"
    st = sync_status(ch)
    assert st == {"l1_dirty": True, "l2_dirty": True, "l3_dirty": True}


# ── baseline markers ──


def test_mark_l2_derived_sets_only_l1_hash():
    ch = _chapter(original="o", script="s", segs=["t"])
    mark_l2_derived(ch)
    assert "l1_hash" in ch.sync_state
    assert "l2_hash" not in ch.sync_state
    assert "segments_hash" not in ch.sync_state


def test_mark_split_sets_l2_and_segments_not_l1():
    ch = _chapter(original="o", script="s", segs=["t"])
    mark_split(ch)
    assert "l2_hash" in ch.sync_state
    assert "segments_hash" in ch.sync_state
    assert "l1_hash" not in ch.sync_state


def test_mark_split_preserves_existing_l1_hash():
    ch = _chapter(original="o", script="s", segs=["t"])
    mark_l2_derived(ch)
    l1 = ch.sync_state["l1_hash"]
    mark_split(ch)
    assert ch.sync_state["l1_hash"] == l1  # untouched
    assert "l2_hash" in ch.sync_state


def test_mark_consistent_sets_all_three():
    ch = _chapter(original="o", script="s", segs=["t"])
    mark_consistent(ch)
    assert set(ch.sync_state.keys()) == {"l1_hash", "l2_hash", "segments_hash"}
