"""edge-tts WebSocket 协议层（纯函数/类，零第三方依赖）

从 spike/cf-workers/src/edge_tts_ws.py 提炼的传输无关协议逻辑：
Sec-MS-GEC token、speech.config / SSML 消息构造、二进制帧解析与跨帧重组。

协议参考：edge_tts/communicate.py (v7.x)；坑位证据：spike/cf-workers/VERDICT.md。
本模块不得 import workers/js/pyodide —— 传输层在 edge_tts_ws_client.py。

与 spike 的两处有意差异：
- mkssml 对文本做 XML 转义（spike 原样插入，含 & < > 的文本会让服务端解析失败）。
- 所有含时间/随机性的函数接受可选注入参数，便于确定性测试。
"""

import hashlib
import time
import uuid
from xml.sax.saxutils import escape as _xml_escape

# --- constants (mirrors edge_tts/constants.py) -------------------------------
BASE_URL = "speech.platform.bing.com/consumer/speech/synthesize/readaloud"
TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4"
CHROMIUM_FULL_VERSION = "143.0.3650.75"
CHROMIUM_MAJOR_VERSION = CHROMIUM_FULL_VERSION.split(".", maxsplit=1)[0]
SEC_MS_GEC_VERSION = f"1-{CHROMIUM_FULL_VERSION}"
WIN_EPOCH = 11644473600
OUTPUT_FORMAT = "audio-24khz-48kbitrate-mono-mp3"

# 服务端要求 WS 握手带齐这些浏览器头，否则拒绝（1006，见 VERDICT.md CP1 坑 1）
WSS_HEADERS = {
    "Pragma": "no-cache",
    "Cache-Control": "no-cache",
    "Origin": "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold",
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        " (KHTML, like Gecko) Chrome/{0}.0.0.0 Safari/537.36 Edg/{0}.0.0.0".format(
            CHROMIUM_MAJOR_VERSION
        )
    ),
    "Accept-Encoding": "gzip, deflate, br, zstd",
    "Accept-Language": "en-US,en;q=0.9",
}


def generate_sec_ms_gec(now: float | None = None) -> str:
    """SHA256(win32_filetime_ticks_rounded_to_5min + trusted token), upper hex."""
    ticks = (time.time() if now is None else now) + WIN_EPOCH
    ticks -= ticks % 300
    ticks *= 10**9 / 100  # 100-ns intervals
    str_to_hash = f"{ticks:.0f}{TRUSTED_CLIENT_TOKEN}"
    return hashlib.sha256(str_to_hash.encode("ascii")).hexdigest().upper()


def connect_id() -> str:
    return uuid.uuid4().hex


def date_to_string(now: float | None = None) -> str:
    return time.strftime(
        "%a %b %d %Y %H:%M:%S GMT+0000 (Coordinated Universal Time)",
        time.gmtime(time.time() if now is None else now),
    )


def mkssml(
    voice: str,
    text: str,
    rate: str = "+0%",
    volume: str = "+0%",
    pitch: str = "+0Hz",
) -> str:
    return (
        "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>"
        f"<voice name='{voice}'>"
        f"<prosody pitch='{pitch}' rate='{rate}' volume='{volume}'>"
        f"{_xml_escape(text)}"
        "</prosody>"
        "</voice>"
        "</speak>"
    )


def speech_config_msg(now: float | None = None) -> str:
    return (
        f"X-Timestamp:{date_to_string(now)}\r\n"
        "Content-Type:application/json; charset=utf-8\r\n"
        "Path:speech.config\r\n\r\n"
        '{"context":{"synthesis":{"audio":{"metadataoptions":{'
        '"sentenceBoundaryEnabled":"true","wordBoundaryEnabled":"false"'
        "},"
        f'"outputFormat":"{OUTPUT_FORMAT}"'
        "}}}}\r\n"
    )


def ssml_msg(ssml: str, request_id: str | None = None, now: float | None = None) -> str:
    return (
        f"X-RequestId:{request_id or connect_id()}\r\n"
        "Content-Type:application/ssml+xml\r\n"
        f"X-Timestamp:{date_to_string(now)}Z\r\n"  # trailing Z: MS quirk, see edge-tts
        "Path:ssml\r\n\r\n"
        f"{ssml}"
    )


def build_wss_url(now: float | None = None, connection_id: str | None = None) -> str:
    """完整 WS 连接 URL（含 Sec-MS-GEC 鉴权参数）。"""
    return (
        f"wss://{BASE_URL}/edge/v1?TrustedClientToken={TRUSTED_CLIENT_TOKEN}"
        f"&ConnectionId={connection_id or connect_id()}"
        f"&Sec-MS-GEC={generate_sec_ms_gec(now)}"
        f"&Sec-MS-GEC-Version={SEC_MS_GEC_VERSION}"
    )


def parse_binary_frame(payload: bytes) -> tuple[dict, bytes]:
    """解析服务端二进制帧为 (headers, data)。

    坑（VERDICT.md CP1 坑 3，与 edge_tts get_headers_and_data 一致）：
    header_len 包含自身 2 字节，头部块从 offset 2 开始，
    头部结束后还有 2 字节 \\r\\n 分隔，data 从 header_len + 2 开始。
    """
    header_len = int.from_bytes(payload[:2], "big")
    head = payload[2:header_len]
    data = payload[header_len + 2 :]  # skip \r\n after headers
    headers = {}
    for line in head.split(b"\r\n"):
        if b":" in line:
            k, v = line.split(b":", 1)
            headers[k.decode(errors="replace")] = v.decode(errors="replace")
    return headers, data


def parse_text_frame(payload: str) -> dict:
    """解析服务端文本帧的头部块（\\r\\n\\r\\n 之前），返回 headers dict。"""
    head = payload.split("\r\n\r\n", 1)[0]
    headers = {}
    for line in head.split("\r\n"):
        if ":" in line:
            k, v = line.split(":", 1)
            headers[k] = v
    return headers


class TurnAssembler:
    """跨帧音频重组：收集 Path:audio 帧的数据，直到 Path:turn.end。"""

    def __init__(self) -> None:
        self._audio = bytearray()
        self.ended = False

    @property
    def audio_bytes(self) -> bytes:
        return bytes(self._audio)

    def feed_text(self, payload: str) -> str:
        """喂入文本帧，返回其 Path；Path:turn.end 时标记结束。"""
        path = parse_text_frame(payload).get("Path", "")
        if path == "turn.end":
            self.ended = True
        return path

    def feed_binary(self, payload: bytes) -> bytes:
        """喂入二进制帧，返回本次的音频数据（非 audio 帧或空数据返回 b""）。"""
        headers, data = parse_binary_frame(payload)
        if headers.get("Path") == "audio" and data:
            self._audio.extend(data)
            return data
        return b""
