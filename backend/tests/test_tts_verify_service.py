"""tts_verify_service：归一化 + 相似度 + diff 比对逻辑测试。

设计文档：docs/superpowers/specs/2026-10-15-tts-asr-verify-design.md
归一化顺序固定：全角转半角 → 去空白 → 去标点 → 小写 → 阿拉伯数字转中文读法。
"""
import pytest

from app.services.tts_verify_service import (
    build_diff,
    normalize_for_compare,
    similarity_ratio,
    verify_texts,
)


class TestNormalizeFullWidth:
    """规则 1：全角转半角。"""

    def test_fullwidth_latin(self):
        assert normalize_for_compare("ＮＡＳＡ") == "nasa"  # 小写化在后续步骤

    def test_fullwidth_punct_removed_later(self):
        # 全角逗号 → 半角逗号 → 标点移除
        assert normalize_for_compare("你好，世界") == "你好世界"

    def test_ideographic_space_removed(self):
        assert normalize_for_compare("a\u3000b") == "ab"


class TestNormalizeWhitespacePunct:
    """规则 2/3：去空白、去中英文标点。"""

    def test_whitespace_removed(self):
        assert normalize_for_compare("你 好  世界\n\t!") == "你好世界"

    def test_chinese_punctuation_removed(self):
        assert normalize_for_compare("「你好」、世界。") == "你好世界"

    def test_english_punctuation_removed(self):
        assert normalize_for_compare("Hello, world! It's fine.") == "helloworlditsfine"

    def test_thousands_separator_vanishes_with_punct(self):
        # 千分位逗号在第 3 步去标点时消失，数字转换按去标点后的数字串进行
        assert normalize_for_compare("1,234") == "一千二百三十四"


class TestNormalizeLowercase:
    """规则 4：小写化。"""

    def test_uppercase_latin(self):
        assert normalize_for_compare("REST API") == "restapi"


class TestNormalizeDigits:
    """规则 5：阿拉伯数字转中文读法（整数和小数）。"""

    @pytest.mark.parametrize(
        ("raw", "expected"),
        [
            ("0", "零"),
            ("3", "三"),
            ("10", "十"),
            ("14", "十四"),
            ("20", "二十"),
            ("105", "一百零五"),
            ("110", "一百一十"),
            ("315", "三百一十五"),
            ("1005", "一千零五"),
            ("2024", "二千零二十四"),
            ("12345", "一万二千三百四十五"),
            ("100000001", "一亿零一"),
            # 小数：整数部分转读 + 点 + 小数位逐位读
            ("3.14", "三点一四"),
            ("0.5", "零点五"),
            ("12.05", "十二点零五"),
        ],
    )
    def test_digits(self, raw, expected):
        assert normalize_for_compare(raw) == expected

    def test_digit_inside_sentence(self):
        assert normalize_for_compare("圆周率是3.14啊") == "圆周率是三点一四啊"

    def test_year_and_decimal_mixed(self):
        assert normalize_for_compare("2024年增长3.5%") == "二千零二十四年增长三点五"


class TestNormalizeCombined:
    def test_full_example(self):
        # 全角 + 标点 + 大小写 + 数字
        assert normalize_for_compare("ＩＤ：１２３，OK！") == "id一百二十三ok"

    def test_empty(self):
        assert normalize_for_compare("") == ""

    def test_only_punct_and_whitespace(self):
        assert normalize_for_compare(" ,。！ \t ") == ""


class TestSimilarity:
    def test_identical(self):
        assert similarity_ratio("你好世界", "你好世界") == 1.0

    def test_disjoint(self):
        assert similarity_ratio("abcd", "wxyz") == 0.0

    def test_partial(self):
        # SequenceMatcher("abcd", "abce").ratio() = 2*3/8 = 0.75
        assert similarity_ratio("abcd", "abce") == pytest.approx(0.75)

    def test_both_empty(self):
        assert similarity_ratio("", "") == 1.0


class TestBuildDiff:
    def test_equal_only(self):
        ops = build_diff("保温杯", "保温杯")
        assert ops == [{"op": "equal", "baseline": "保温杯", "asr": "保温杯"}]

    def test_replace(self):
        ops = build_diff("不锈钢保温杯", "不锈纲保温杯")
        assert {"op": "replace", "baseline": "钢", "asr": "纲"} in ops
        assert {"op": "equal", "baseline": "保温杯", "asr": "保温杯"} in ops

    def test_delete_and_insert(self):
        ops = build_diff("abcd", "abd")
        assert {"op": "delete", "baseline": "c", "asr": ""} in ops
        ops = build_diff("abd", "abcd")
        assert {"op": "insert", "baseline": "", "asr": "c"} in ops

    def test_ops_concatenate_to_full_texts(self):
        a, b = "保温杯可以装热水", "保温杯可装热水呢"
        ops = build_diff(a, b)
        assert "".join(o["baseline"] for o in ops) == a
        assert "".join(o["asr"] for o in ops) == b


class TestVerifyTexts:
    def test_match_above_threshold(self):
        result = verify_texts("保温杯可以装热水", "保温杯可以装热水。")
        assert result["match"] is True
        assert result["similarity"] == pytest.approx(1.0)
        assert result["normalized_baseline"] == "保温杯可以装热水"
        assert result["normalized_asr"] == "保温杯可以装热水"

    def test_mismatch_below_threshold(self):
        result = verify_texts("保温杯可以装热水", "完全不一样的内容")
        assert result["match"] is False
        assert result["similarity"] < 0.8

    def test_threshold_boundary_custom(self):
        # similarity 0.75，阈值 0.7 → match；阈值 0.8 → mismatch
        result = verify_texts("abcd", "abce", threshold=0.7)
        assert result["match"] is True
        result = verify_texts("abcd", "abce", threshold=0.8)
        assert result["match"] is False

    def test_diff_always_present(self):
        result = verify_texts("不锈钢", "不锈纲")
        assert isinstance(result["diff"], list)
        assert len(result["diff"]) > 0

    def test_asr_empty_similarity_zero(self):
        result = verify_texts("保温杯", "")
        assert result["match"] is False
        assert result["similarity"] == 0.0

    def test_digit_reading_alignment(self):
        # 基准数字 → ASR 中文读法，归一化后应一致
        result = verify_texts("温度是3.14度", "温度是三点一四度")
        assert result["match"] is True
