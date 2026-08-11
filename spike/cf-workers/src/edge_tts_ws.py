"""Hand-rolled edge-tts client for Cloudflare Workers Python (Pyodide).

Reimplements the minimal slice of the `edge-tts` package protocol that
NarraForge's backend needs, without aiohttp:

  * Sec-MS-GEC token (see edge_tts/drm.py: SHA256 of win32 ticks + trusted token)
  * WebSocket connect to speech.platform.bing.com via the JS WebSocket API (FFI)
  * speech.config (mp3 output) + SSML request, binary audio frames until turn.end

Protocol reference: edge_tts/communicate.py (v7.x).
"""
import asyncio
import hashlib
import time
import uuid

from js import Object, Uint8Array, fetch
from pyodide.ffi import create_proxy, to_js

# --- constants (mirrors edge_tts/constants.py) -------------------------------
BASE_URL = "speech.platform.bing.com/consumer/speech/synthesize/readaloud"
TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4"
WSS_URL = f"wss://{BASE_URL}/edge/v1?TrustedClientToken={TRUSTED_CLIENT_TOKEN}"
CHROMIUM_FULL_VERSION = "143.0.3650.75"
CHROMIUM_MAJOR_VERSION = CHROMIUM_FULL_VERSION.split(".", maxsplit=1)[0]
SEC_MS_GEC_VERSION = f"1-{CHROMIUM_FULL_VERSION}"
WIN_EPOCH = 11644473600
OUTPUT_FORMAT = "audio-24khz-48kbitrate-mono-mp3"

# Headers the service demands on the WS handshake (captured from aiohttp, see
# VERDICT.md). A bare `new WebSocket(url)` handshake is rejected (1006).
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


def generate_sec_ms_gec() -> str:
    """SHA256(win32_filetime_ticks_rounded_to_5min + trusted token), upper hex."""
    ticks = time.time() + WIN_EPOCH
    ticks -= ticks % 300
    ticks *= 10**9 / 100  # 100-ns intervals
    str_to_hash = f"{ticks:.0f}{TRUSTED_CLIENT_TOKEN}"
    return hashlib.sha256(str_to_hash.encode("ascii")).hexdigest().upper()


def connect_id() -> str:
    return uuid.uuid4().hex


def date_to_string() -> str:
    return time.strftime(
        "%a %b %d %Y %H:%M:%S GMT+0000 (Coordinated Universal Time)", time.gmtime()
    )


def mkssml(voice: str, text: str, rate: str = "+0%", volume: str = "+0%",
           pitch: str = "+0Hz") -> str:
    return (
        "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>"
        f"<voice name='{voice}'>"
        f"<prosody pitch='{pitch}' rate='{rate}' volume='{volume}'>"
        f"{text}"
        "</prosody>"
        "</voice>"
        "</speak>"
    )


def speech_config_msg() -> str:
    return (
        f"X-Timestamp:{date_to_string()}\r\n"
        "Content-Type:application/json; charset=utf-8\r\n"
        "Path:speech.config\r\n\r\n"
        '{"context":{"synthesis":{"audio":{"metadataoptions":{'
        '"sentenceBoundaryEnabled":"true","wordBoundaryEnabled":"false"'
        "},"
        f'"outputFormat":"{OUTPUT_FORMAT}"'
        "}}}}\r\n"
    )


def ssml_msg(ssml: str) -> str:
    return (
        f"X-RequestId:{connect_id()}\r\n"
        "Content-Type:application/ssml+xml\r\n"
        f"X-Timestamp:{date_to_string()}Z\r\n"  # trailing Z: MS quirk, see edge-tts
        "Path:ssml\r\n\r\n"
        f"{ssml}"
    )


def _headers_and_data(payload: bytes, header_len: int):
    # header_len INCLUDES the 2 length bytes (see edge_tts get_headers_and_data),
    # so the real header block starts at offset 2.
    head = payload[2:header_len]
    data = payload[header_len + 2 :]  # skip \r\n after headers
    headers = {}
    for line in head.split(b"\r\n"):
        if b":" in line:
            k, v = line.split(b":", 1)
            headers[k.decode(errors="replace")] = v.decode(errors="replace")
    return headers, data


class _WsBridge:
    """Adapt a Workers outbound WebSocket (fetch upgrade) to an asyncio.Queue.

    `new WebSocket(url)` cannot set handshake headers, and the service rejects
    headerless handshakes. Workers' `fetch(url, {headers: {Upgrade: websocket,
    ...}})` returns `response.webSocket`, which we accept() and drive with
    event listeners.
    """

    def __init__(self):
        self.queue: asyncio.Queue = asyncio.Queue()
        self.open_fut = asyncio.get_event_loop().create_future()
        self.ws = None
        self._proxies = []

    async def connect(self, url: str):
        headers = dict(WSS_HEADERS)
        headers["Cookie"] = f"muid={uuid.uuid4().hex.upper()};"
        headers["Upgrade"] = "websocket"
        resp = await fetch(
            url.replace("wss://", "https://", 1),  # fetch() rejects wss://
            to_js(
                {"method": "GET", "headers": headers},
                dict_converter=Object.fromEntries,
            ),
        )
        if int(resp.status) != 101:
            body = await resp.text()
            raise RuntimeError(
                f"WS upgrade rejected: HTTP {resp.status}, body={body[:200]!r}"
            )
        self.ws = resp.webSocket
        self.ws.accept()
        for event, handler in (
            ("message", self._on_message),
            ("error", self._on_error),
            ("close", self._on_close),
        ):
            p = create_proxy(handler)
            self._proxies.append(p)
            self.ws.addEventListener(event, p)
        if not self.open_fut.done():
            self.open_fut.set_result(True)

    def _on_message(self, ev):
        try:
            data = ev.data
            if isinstance(data, str):
                self.queue.put_nowait(("text", data))
            else:
                # ArrayBuffer -> Uint8Array view -> memoryview via to_py()
                self.queue.put_nowait(("binary", bytes(Uint8Array.new(data).to_py())))
        except Exception as e:
            self.queue.put_nowait(("error", f"message conversion failed: {type(e).__name__}: {e}"))

    def _on_error(self, ev):
        msg = getattr(ev, "message", None) or "websocket error event"
        if not self.open_fut.done():
            self.open_fut.set_exception(RuntimeError(f"websocket error before open: {msg}"))
        self.queue.put_nowait(("error", str(msg)))

    def _on_close(self, ev):
        msg = f"code={ev.code} reason={ev.reason}"
        if not self.open_fut.done():
            self.open_fut.set_exception(RuntimeError(f"websocket closed before open: {msg}"))
        self.queue.put_nowait(("close", msg))

    async def send(self, s: str):
        self.ws.send(s)


async def synthesize(text: str, voice: str = "zh-CN-XiaoxiaoNeural",
                     timeout: float = 60.0) -> dict:
    """One-shot edge-tts synthesis. Returns dict with audio bytes + diagnostics."""
    url = (
        f"{WSS_URL}&ConnectionId={connect_id()}"
        f"&Sec-MS-GEC={generate_sec_ms_gec()}"
        f"&Sec-MS-GEC-Version={SEC_MS_GEC_VERSION}"
    )
    bridge = _WsBridge()
    log = []

    async def _run() -> bytes:
        await asyncio.wait_for(bridge.connect(url), timeout=30)
        log.append("ws upgrade accepted (101)")
        await bridge.send(speech_config_msg())
        await bridge.send(ssml_msg(mkssml(voice, text)))
        log.append("config+ssml sent")
        audio = bytearray()
        while True:
            kind, payload = await asyncio.wait_for(bridge.queue.get(), timeout=timeout)
            if kind == "text":
                head = payload.split("\r\n\r\n", 1)[0]
                path = ""
                for line in head.split("\r\n"):
                    if line.startswith("Path:"):
                        path = line[5:]
                log.append(f"text frame Path:{path}")
                if path == "turn.end":
                    break
            elif kind == "binary":
                buf = payload
                log.append(f"bin frame {len(buf)}B head={buf[:24].hex()}")
                header_len = int.from_bytes(buf[:2], "big")
                headers, data = _headers_and_data(buf, header_len)
                if headers.get("Path") == "audio" and data:
                    audio.extend(data)
                    log.append(f"audio chunk {len(data)}B (total {len(audio)})")
            elif kind in ("error", "close"):
                raise RuntimeError(f"websocket {kind}: {payload}")
        return bytes(audio)

    try:
        audio = await _run()
    except Exception as e:
        return {"error": f"{type(e).__name__}: {e}", "log": log}
    finally:
        try:
            if bridge.ws is not None:
                bridge.ws.close()
        except Exception:
            pass
    return {"audio": audio, "log": log, "url_head": url.split("&Sec-MS-GEC=")[0]}


def is_mp3(data: bytes) -> bool:
    """ID3 tag or MPEG frame sync (0xFFEx)."""
    if data[:3] == b"ID3":
        return True
    return len(data) > 1 and data[0] == 0xFF and (data[1] & 0xE0) == 0xE0
