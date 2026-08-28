"""合成时文本变换纯函数单测（发音映射 + 大写转小写）。

前端镜像：frontend/src/services/textTransforms.ts —— 本文件的测试用例与
textTransforms.test.ts 一一对应，规则改动两侧必须同步。
"""
from app.services.text_transform_service import (
    apply_pronunciation_map,
    apply_text_transforms,
    lowercase_latin_words,
    merge_maps,
    resolve_lowercase_latin,
)


# ---- merge_maps ----

def test_merge_project_overrides_global_same_source():
    merged = merge_maps(
        [{"id": "gpm_1", "source": "调动", "target": "全球版"}],
        [{"id": "pm_1", "source": "调动", "target": "项目版"}],
    )
    assert merged == [{"id": "pm_1", "source": "调动", "target": "项目版"}]


def test_merge_keeps_distinct_entries():
    merged = merge_maps(
        [{"id": "gpm_1", "source": "调动", "target": "掉动"}],
        [{"id": "pm_1", "source": "行长", "target": "行长2"}],
    )
    assert {e["id"] for e in merged} == {"gpm_1", "pm_1"}


def test_merge_ignores_empty_source():
    assert merge_maps([{"id": "gpm_1", "source": "", "target": "x"}], None) == []


# ---- apply_pronunciation_map ----

def test_apply_longest_source_first():
    # 长度降序：长 source 优先，避免短词吃掉长词前缀
    entries = [
        {"id": "pm_1", "source": "调动", "target": "掉动"},
        {"id": "pm_2", "source": "调动工作", "target": "调度工作"},
    ]
    assert apply_pronunciation_map("调动工作要调动", entries) == "调度工作要掉动"


def test_apply_is_single_pass_not_recursive():
    entries = [{"id": "pm_1", "source": "a", "target": "aa"}]
    assert apply_pronunciation_map("a", entries) == "aa"  # 不会循环成 aaaa...


def test_apply_chains_across_entries_in_length_order():
    # 跨条目链式替换（单条目内不递归）：A 的 target 含 B 的 source 时会被 B 再替换。
    # 两侧镜像必须一致：Python sorted 与 JS Array.prototype.sort 均为稳定排序。
    entries = [
        {"id": "pm_a", "source": "a", "target": "b"},
        {"id": "pm_b", "source": "b", "target": "c"},
    ]
    assert apply_pronunciation_map("a", entries) == "c"


# ---- lowercase_latin_words ----

def test_lowercase_mixed_text():
    assert lowercase_latin_words("REST API 接口") == "rest api 接口"


def test_lowercase_skips_single_letter_and_titlecase():
    assert lowercase_latin_words("I think Http is OK") == "I think Http is ok"


def test_lowercase_skips_trailing_digit_identifiers():
    assert lowercase_latin_words("HTTP2 协议") == "HTTP2 协议"


# ---- resolve_lowercase_latin ----

def test_resolve_lowercase_segment_overrides_project():
    assert resolve_lowercase_latin(False, True) is False
    assert resolve_lowercase_latin(True, False) is True
    assert resolve_lowercase_latin(None, True) is True
    assert resolve_lowercase_latin(None, None) is False


# ---- apply_text_transforms ----

MAP = [
    {"id": "pm_a", "source": "调动", "target": "掉动"},
    {"id": "pm_b", "source": "队伍", "target": "团队"},
]


def test_apply_all_ignores_segment_selection():
    out = apply_text_transforms("他调动了队伍", merged_map=MAP, apply_all=True)
    assert out == "他掉动了团队"


def test_segment_selection_picks_subset():
    out = apply_text_transforms(
        "他调动了队伍", merged_map=MAP, applied_map_ids=["pm_a"],
    )
    assert out == "他掉动了队伍"


def test_dangling_map_id_ignored():
    out = apply_text_transforms(
        "他调动了队伍", merged_map=MAP, applied_map_ids=["pm_gone"],
    )
    assert out == "他调动了队伍"


def test_lowercase_applied_after_mapping():
    # 映射 target 中的全大写词也会被小写化（顺序：映射 → 小写）
    entries = [{"id": "pm_1", "source": "接口", "target": "API"}]
    out = apply_text_transforms(
        "这个接口", merged_map=entries, apply_all=True, lowercase_latin=True,
    )
    assert out == "这个api"


def test_empty_text_noop():
    assert apply_text_transforms("", merged_map=MAP, apply_all=True) == ""
