"""
验证外部公网 URL（如 GitHub raw、七牛云）能否被 Qwen CosyVoice 声音克隆 API 访问

用例：
1. GitHub blob URL（返回 HTML）- 应失败
2. GitHub raw URL（返回 audio/mpeg）- 应成功创建 voice_id 并最终 status=OK

运行：
    cd backend
    uv run pytest tests/integration/test_external_url_clone.py -s -v
"""
import os
import sys
import time
import pytest
import requests
from datetime import datetime

# 确保能 import app 模块
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from app.core.config import settings


BLOB_URL = "https://github.com/whoisrio/rio-image-bed/blob/main/voices/05571403-8f31-4de3-89a0-8a0540b462b8.mp3"
RAW_URL = "https://raw.githubusercontent.com/whoisrio/rio-image-bed/main/voices/05571403-8f31-4de3-89a0-8a0540b462b8.mp3"


def _head(url: str) -> dict:
    """
    HEAD 请求，使用本地代理（如有），返回 status_code + content_type

    注意：本地能否访问不代表 Qwen 服务端能访问。Qwen 服务端在阿里云，
    访问 raw.githubusercontent.com 可能受网络/防火墙限制。
    """
    resp = requests.head(url, timeout=30, allow_redirects=True)
    return {
        "status_code": resp.status_code,
        "content_type": resp.headers.get("Content-Type", ""),
        "content_length": resp.headers.get("Content-Length", ""),
    }


def test_blob_url_returns_html_not_audio():
    """GitHub blob URL 返回 HTML 页面，不是音频文件"""
    info = _head(BLOB_URL)
    print(f"\n[blob] {info}")
    assert info["status_code"] == 200
    assert "text/html" in info["content_type"], (
        f"blob URL 应该返回 HTML，实际是 {info['content_type']}"
    )


def test_raw_url_returns_audio():
    """GitHub raw URL 返回真正的 audio/mpeg"""
    info = _head(RAW_URL)
    print(f"\n[raw] {info}")
    assert info["status_code"] == 200
    assert "audio" in info["content_type"], (
        f"raw URL 应该返回音频，实际是 {info['content_type']}"
    )


@pytest.mark.external
@pytest.mark.skipif(
    os.getenv("RUN_EXTERNAL_QWEN_TESTS") != "1" or not settings.qwen_api_key or settings.qwen_api_key in ("", "1"),
    reason="需要显式设置 RUN_EXTERNAL_QWEN_TESTS=1 且配置 QWEN_API_KEY 才运行真实 Qwen 外部调用",
)
def test_qwen_clone_with_raw_github_url():
    """
    用 GitHub raw URL 调用 Qwen CosyVoice 完整声音克隆流程：
    create_voice -> 轮询 query_voice 直到 status=OK
    """
    import dashscope
    from dashscope.audio.tts_v2 import VoiceEnrollmentService

    dashscope.api_key = settings.qwen_api_key

    service = VoiceEnrollmentService()
    prefix = f"clone{datetime.now().strftime('%H%M%S')}"[:9]

    print(f"\n[qwen] creating voice with prefix={prefix} model={settings.qwen_model}")
    print(f"[qwen] audio_url={RAW_URL}")

    voice_id = service.create_voice(
        target_model=settings.qwen_model,
        prefix=prefix,
        url=RAW_URL,
    )
    print(f"[qwen] voice_id={voice_id} request_id={service.get_last_request_id()}")
    assert voice_id, "create_voice 应返回非空 voice_id"

    # 轮询等待 OK
    max_attempts = 18  # ~3 min
    poll_interval = 10
    final_status = None
    for i in range(max_attempts):
        info = service.query_voice(voice_id=voice_id)
        final_status = info.get("status")
        print(f"[qwen] attempt {i+1}/{max_attempts} status={final_status} info={info}")
        if final_status == "OK":
            break
        if final_status == "UNDEPLOYED":
            pytest.fail(f"克隆失败，status=UNDEPLOYED, info={info}")
        time.sleep(poll_interval)

    assert final_status == "OK", f"超时未就绪，最后状态={final_status}"


@pytest.mark.external
@pytest.mark.skipif(
    os.getenv("RUN_EXTERNAL_QWEN_TESTS") != "1" or not settings.qwen_api_key or settings.qwen_api_key in ("", "1"),
    reason="需要显式设置 RUN_EXTERNAL_QWEN_TESTS=1 且配置 QWEN_API_KEY 才运行真实 Qwen 外部调用",
)
def test_qwen_clone_with_blob_url_should_fail():
    """
    用 GitHub blob URL（HTML 页面）调用 Qwen 应失败 / 最终 status 不为 OK
    """
    import dashscope
    from dashscope.audio.tts_v2 import VoiceEnrollmentService, VoiceEnrollmentException

    dashscope.api_key = settings.qwen_api_key

    service = VoiceEnrollmentService()
    prefix = f"bad{datetime.now().strftime('%H%M%S')}"[:9]

    print(f"\n[qwen-bad] creating voice with blob url={BLOB_URL}")

    try:
        voice_id = service.create_voice(
            target_model=settings.qwen_model,
            prefix=prefix,
            url=BLOB_URL,
        )
    except VoiceEnrollmentException as e:
        print(f"[qwen-bad] create_voice 直接抛错（预期）: {e}")
        return  # 直接拒绝也是正确行为

    print(f"[qwen-bad] voice_id={voice_id}（注意：可能后续 status=UNDEPLOYED）")

    # 轮询：blob URL 是 HTML，预期最终 UNDEPLOYED 或永不 OK
    for i in range(6):
        info = service.query_voice(voice_id=voice_id)
        status = info.get("status")
        print(f"[qwen-bad] attempt {i+1} status={status} info={info}")
        if status == "UNDEPLOYED":
            return  # 符合预期
        if status == "OK":
            pytest.fail(
                f"意外：blob URL 也能克隆成功？可能 Qwen 做了二次处理。voice_id={voice_id}"
            )
        time.sleep(10)
