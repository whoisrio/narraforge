"""edge_tts_protocol 单元测试（纯协议逻辑，无任何运行时依赖）

来源：spike/cf-workers/src/edge_tts_ws.py 产品化提炼（证据 spike/cf-workers/VERDICT.md）。
覆盖：Sec-MS-GEC token、SSML 构造（含转义）、speech.config / ssml 消息、
二进制帧解析（header_len 含自身 2 字节的坑）、跨帧音频重组。
"""
import hashlib

import pytest

from app.services import edge_tts_protocol as proto


# --- Sec-MS-GEC token ---

class TestSecMsGec:
    # 参考值：now=1_700_000_000 时按 spike 公式 SHA256(f"{ticks}{TOKEN}").upper()
    # ticks = (1700000000 + 11644473600) 向下取整到 300s 后 * 1e7 = 133444734000000000
    REFERENCE_NOW = 1_700_000_000
    REFERENCE_HASH = "42301B335578FEFDAE2637DED1ABD614505D432559EC08032B82048483726AFF"

    def test_matches_spike_reference_value(self):
        assert proto.generate_sec_ms_gec(now=self.REFERENCE_NOW) == self.REFERENCE_HASH

    def test_rounds_down_to_5min_window(self):
        """同一 5 分钟窗口内的时间产生相同 token，跨窗口则不同。

        REFERENCE_NOW 对齐后的 win32 ticks 在窗口内偏移 200s，
        因此 +99s 同窗，+100s 跨窗。
        """
        h1 = proto.generate_sec_ms_gec(now=self.REFERENCE_NOW)
        h2 = proto.generate_sec_ms_gec(now=self.REFERENCE_NOW + 99)
        h3 = proto.generate_sec_ms_gec(now=self.REFERENCE_NOW + 100)
        assert h1 == h2
        assert h1 != h3

    def test_default_uses_current_time(self):
        token = proto.generate_sec_ms_gec()
        assert len(token) == 64
        assert token == token.upper()

    def test_reference_hash_is_independently_verifiable(self):
        """防止参考值和实现一起写错：独立按 spike 公式重算一遍。"""
        ticks = self.REFERENCE_NOW + 11644473600
        ticks -= ticks % 300
        ticks *= 10**9 / 100
        s = f"{ticks:.0f}{proto.TRUSTED_CLIENT_TOKEN}"
        assert hashlib.sha256(s.encode("ascii")).hexdigest().upper() == self.REFERENCE_HASH


# --- 小工具函数 ---

class TestHelpers:
    def test_connect_id_is_32char_hex(self):
        cid = proto.connect_id()
        assert len(cid) == 32
        int(cid, 16)  # 合法 hex

    def test_date_to_string_format(self):
        # 2023-11-14 22:13:20 UTC
        s = proto.date_to_string(now=1_700_000_000)
        assert s == "Tue Nov 14 2023 22:13:20 GMT+0000 (Coordinated Universal Time)"


# --- SSML 构造 ---

class TestMkssml:
    def test_structure_and_params(self):
        ssml = proto.mkssml("zh-CN-XiaoxiaoNeural", "你好", rate="+10%", volume="-5%", pitch="+2Hz")
        assert ssml.startswith("<speak version='1.0'")
        assert "<voice name='zh-CN-XiaoxiaoNeural'>" in ssml
        assert "<prosody pitch='+2Hz' rate='+10%' volume='-5%'>" in ssml
        assert ssml.endswith("</prosody></voice></speak>")
        assert ">你好</prosody>" in ssml

    def test_default_params(self):
        ssml = proto.mkssml("zh-CN-XiaoxiaoNeural", "文本")
        assert "pitch='+0Hz' rate='+0%' volume='+0%'" in ssml

    def test_text_is_xml_escaped(self):
        """文本里的 XML 特殊字符必须转义，否则服务端解析 SSML 会失败。"""
        ssml = proto.mkssml("v", "A & B <C> \"D\"")
        assert "A &amp; B &lt;C&gt;" in ssml
        assert "<C>" not in ssml


# --- speech.config / ssml 消息 ---

class TestMessages:
    def test_speech_config_msg(self):
        msg = proto.speech_config_msg(now=1_700_000_000)
        assert msg.startswith("X-Timestamp:Tue Nov 14 2023")
        assert "\r\nContent-Type:application/json; charset=utf-8\r\n" in msg
        assert "\r\nPath:speech.config\r\n\r\n" in msg
        assert f'"outputFormat":"{proto.OUTPUT_FORMAT}"' in msg
        assert '"wordBoundaryEnabled":"false"' in msg
        assert msg.endswith("\r\n")

    def test_ssml_msg(self):
        msg = proto.ssml_msg("<speak/>", request_id="abc123", now=1_700_000_000)
        assert msg.startswith("X-RequestId:abc123\r\n")
        assert "\r\nContent-Type:application/ssml+xml\r\n" in msg
        # 微软怪癖：X-Timestamp 尾部带 Z（见 edge-tts communicate.py）
        assert "GMT+0000 (Coordinated Universal Time)Z\r\n" in msg
        assert "\r\nPath:ssml\r\n\r\n" in msg
        assert msg.endswith("<speak/>")


# --- WSS URL ---

class TestWssUrl:
    def test_contains_required_params(self):
        url = proto.build_wss_url(now=1_700_000_000, connection_id="c" * 32)
        assert url.startswith("wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1")
        assert f"TrustedClientToken={proto.TRUSTED_CLIENT_TOKEN}" in url
        assert f"ConnectionId={'c' * 32}" in url
        assert f"Sec-MS-GEC={TestSecMsGec.REFERENCE_HASH}" in url
        assert f"Sec-MS-GEC-Version={proto.SEC_MS_GEC_VERSION}" in url


# --- 二进制帧解析（header_len 含自身 2 字节的坑） ---

def _make_binary_frame(headers: list[tuple[str, str]], data: bytes) -> bytes:
    """按 edge-tts get_headers_and_data 的线格式构造一帧：
    [2B header_len(含自身)][headers][\r\n][data]
    """
    head = b"\r\n".join(f"{k}:{v}".encode() for k, v in headers)
    header_len = 2 + len(head)
    return header_len.to_bytes(2, "big") + head + b"\r\n" + data


class TestParseBinaryFrame:
    def test_header_len_includes_its_own_two_bytes(self):
        frame = _make_binary_frame(
            [("X-RequestId", "abc"), ("Content-Type", "audio/mpeg"), ("Path", "audio")],
            b"AUDIO",
        )
        headers, data = proto.parse_binary_frame(frame)
        assert headers == {
            "X-RequestId": "abc",
            "Content-Type": "audio/mpeg",
            "Path": "audio",
        }
        assert data == b"AUDIO"

    def test_empty_data(self):
        frame = _make_binary_frame([("Path", "audio")], b"")
        headers, data = proto.parse_binary_frame(frame)
        assert headers["Path"] == "audio"
        assert data == b""


# --- 文本帧解析 ---

class TestParseTextFrame:
    def test_path_extraction(self):
        payload = "X-RequestId:abc\r\nContent-Type:application/json\r\nPath:turn.end\r\n\r\n{}"
        headers = proto.parse_text_frame(payload)
        assert headers["Path"] == "turn.end"
        assert headers["X-RequestId"] == "abc"


# --- 跨帧重组 ---

class TestTurnAssembler:
    def test_accumulates_audio_across_frames(self):
        asm = proto.TurnAssembler()
        chunks = [
            asm.feed_binary(_make_binary_frame([("Path", "audio")], b"AAA")),
            asm.feed_binary(_make_binary_frame([("Path", "audio")], b"BBB")),
        ]
        assert chunks == [b"AAA", b"BBB"]
        assert asm.audio_bytes == b"AAABBB"
        assert not asm.ended

    def test_skips_empty_audio_and_non_audio_paths(self):
        asm = proto.TurnAssembler()
        assert asm.feed_binary(_make_binary_frame([("Path", "audio")], b"")) == b""
        assert asm.feed_binary(_make_binary_frame([("Path", "audio.metadata")], b"{}")) == b""
        assert asm.audio_bytes == b""

    def test_turn_end_marks_ended(self):
        asm = proto.TurnAssembler()
        asm.feed_binary(_make_binary_frame([("Path", "audio")], b"AAA"))
        path = asm.feed_text("X-RequestId:abc\r\nPath:turn.end\r\n\r\n")
        assert path == "turn.end"
        assert asm.ended
        assert asm.audio_bytes == b"AAA"

    def test_other_text_frames_do_not_end(self):
        asm = proto.TurnAssembler()
        assert asm.feed_text("X-RequestId:abc\r\nPath:turn.start\r\n\r\n") == "turn.start"
        assert asm.feed_text("X-RequestId:abc\r\nPath:response\r\n\r\n") == "response"
        assert not asm.ended
