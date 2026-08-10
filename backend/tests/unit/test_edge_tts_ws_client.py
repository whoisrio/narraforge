"""edge_tts_ws_client 单元测试

传输层只在 Cloudflare Workers Python (Pyodide) 运行时可用（workers.fetch 的
WebSocket Upgrade）。本地没有 workers 运行时，不做真实 WS 连接测试
（协议层单测见 test_edge_tts_protocol.py，端到端证据见 spike/cf-workers/VERDICT.md）。
这里只锁定：Pyodide 外调用时给出清晰错误，而不是裸 ImportError。
"""
import pytest

from app.services import edge_tts_ws_client


@pytest.mark.asyncio
async def test_synthesize_outside_pyodide_raises_clear_error():
    with pytest.raises(RuntimeError, match="Cloudflare Workers"):
        await edge_tts_ws_client.synthesize(text="你好", voice="zh-CN-XiaoxiaoNeural")


def test_module_imports_without_pyodide_modules():
    """模块本身必须可在本地 CPython 导入（workers/js/pyodide import 全部延迟到运行时）。"""
    import sys

    assert "workers" not in sys.modules
    assert "js" not in sys.modules
    assert "pyodide" not in sys.modules
