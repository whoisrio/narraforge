import pytest
from app.services.narration_versioning.ids import (
    project_slug, chapter_id, next_segment_id,
    is_valid_slug, is_valid_segment_id,
)


class TestProjectSlug:
    def test_ascii_letters_lowercased(self):
        assert project_slug("Hello World") == "hello-world"

    def test_chinese_to_pinyin(self):
        assert project_slug("你好世界") == "ni-hao-shi-jie"

    def test_mixed_ascii_chinese(self):
        # pypinyin renders 略 as "lve" (not "lue")
        assert project_slug("DeepSeek 策略") == "deepseek-ce-lve"

    def test_strips_special_chars(self):
        assert project_slug("Foo/Bar_Baz!") == "foo-bar-baz"

    def test_collapses_dashes(self):
        assert project_slug("a---b") == "a-b"

    def test_trims_dashes(self):
        assert project_slug("--foo--") == "foo"

    def test_empty_falls_back(self):
        assert project_slug("") == "project"
        assert project_slug("!!!") == "project"

    def test_max_length(self):
        assert len(project_slug("a" * 100)) <= 40

    def test_deterministic(self):
        assert project_slug("测试项目") == project_slug("测试项目")


class TestChapterId:
    def test_position_and_slug(self):
        assert chapter_id(1, "开场白") == "ch01-kai-chang-bai"

    def test_pads_to_two_digits(self):
        assert chapter_id(9, "x").startswith("ch09-")
        assert chapter_id(12, "x").startswith("ch12-")

    def test_no_slug_when_empty(self):
        assert chapter_id(1, "") == "ch01"
        assert chapter_id(1, None) == "ch01"


class TestNextSegmentId:
    def test_first_is_s001(self):
        assert next_segment_id(existing=set()) == "s001"

    def test_deleted_ids_not_reused(self):
        assert next_segment_id(existing={"s001", "s003"}) == "s004"

    def test_after_100(self):
        existing = {f"s{i:03d}" for i in range(1, 101)}
        assert next_segment_id(existing=existing) == "s101"

    def test_ignores_legacy(self):
        assert next_segment_id(existing={"legacy-xyz"}) == "s001"


class TestValidators:
    @pytest.mark.parametrize("s,ok", [
        ("a", True), ("foo", True), ("foo-bar", True), ("a1b2", True),
        ("hello-世界", False), ("", False), ("-foo", False), ("foo-", False),
        ("a" * 41, False),
    ])
    def test_slug_shape(self, s, ok):
        assert is_valid_slug(s) is ok

    @pytest.mark.parametrize("s,ok", [
        ("s001", True), ("s999", True),
        ("s0001", False), ("s1", False),
        ("S001", False), ("segment-1", False),
    ])
    def test_segment_id_shape(self, s, ok):
        assert is_valid_segment_id(s) is ok
