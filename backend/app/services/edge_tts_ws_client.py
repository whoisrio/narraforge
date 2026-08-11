"""edge-tts WebSocket 传输层（仅 Cloudflare Workers Python / Pyodide 运行时）

基于 spike/cf-workers/src/edge_tts_ws.py 产品化：
- 协议逻辑（Sec-MS-GEC / SSML / 消息 / 帧重组）全部在 edge_tts_protocol.py。
- 本模块只负责传输：workers.fetch 的 WebSocket Upgrade + 事件桥接。

`workers` / `js` / `pyodide` 模块只存在于 Pyodide 运行时，全部延迟到函数内 import；
Pyodide 之外调用会抛出带清晰说明的 RuntimeError（本地模式应走 edge-tts 包，
见 edge_tts_service.py 的策略分发）。

本步不做真实 WS 连接测试：协议层单测 + spike 端到端证据（VERDICT.md CP1）。
"""

import asyncio
import logging

from app.services import edge_tts_protocol as proto

logger = logging.getLogger(__name__)

_PYODIDE_REQUIRED_MSG = (
    "edge-tts WS client requires the Cloudflare Workers Python (Pyodide) runtime; "
    "local mode must use the edge-tts package instead"
)


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
        try:
            from workers import fetch
            from js import Object
            from pyodide.ffi import to_js
        except ImportError as e:
            raise RuntimeError(_PYODIDE_REQUIRED_MSG) from e

        headers = dict(proto.WSS_HEADERS)
        import uuid

        headers["Cookie"] = f"muid={uuid.uuid4().hex.upper()};"
        headers["Upgrade"] = "websocket"
        resp = await fetch(
            url.replace("wss://", "https://", 1),  # fetch() rejects wss:// (VERDICT.md CP1 坑 2)
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
        from pyodide.ffi import create_proxy

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
                # ArrayBuffer -> Uint8Array view -> bytes（memoryview(JsProxy) 会报错，见 VERDICT.md）
                from js import Uint8Array

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

    def close(self):
        if self.ws is not None:
            try:
                self.ws.close()
            except Exception:
                pass


async def synthesize(
    text: str,
    voice: str,
    rate: str = "+0%",
    volume: str = "+0%",
    timeout: float = 60.0,
) -> bytes:
    """一次性 edge-tts 合成（Workers 运行时）。成功返回 mp3 字节，失败抛异常。

    Pyodide 之外调用抛出 RuntimeError（workers/js/pyodide 不可用）。
    """
    url = proto.build_wss_url()
    bridge = _WsBridge()

    async def _run() -> bytes:
        await asyncio.wait_for(bridge.connect(url), timeout=30)
        await bridge.send(proto.speech_config_msg())
        await bridge.send(proto.ssml_msg(proto.mkssml(voice, text, rate=rate, volume=volume)))
        assembler = proto.TurnAssembler()
        while not assembler.ended:
            kind, payload = await asyncio.wait_for(bridge.queue.get(), timeout=timeout)
            if kind == "text":
                assembler.feed_text(payload)
            elif kind == "binary":
                assembler.feed_binary(payload)
            elif kind in ("error", "close"):
                raise RuntimeError(f"websocket {kind}: {payload}")
        return assembler.audio_bytes

    try:
        return await _run()
    finally:
        bridge.close()
