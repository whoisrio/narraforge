import httpx
import pytest

from app.backend_client import BackendClient


def _make_client(handler):
    transport = httpx.MockTransport(handler)
    return BackendClient(base_url="http://test", transport=transport)


@pytest.mark.asyncio
async def test_synthesize_segment_sends_params():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["body"] = httpx.QueryParams(request.url.path)  # placeholder, replaced below
        import json as _json

        seen["json"] = _json.loads(request.content)
        return httpx.Response(200, json={"id": "p1"})

    client = _make_client(handler)
    await client.synthesize_segment("p1", "c1", "s1", params={"engine": "edge_tts", "edge_voice": "zh-CN-XiaoxiaoNeural"})
    assert seen["json"]["params"] == {"engine": "edge_tts", "edge_voice": "zh-CN-XiaoxiaoNeural"}
    assert seen["json"]["keep_previous"] is True


@pytest.mark.asyncio
async def test_synthesize_segment_default_params_none():
    import json as _json

    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["json"] = _json.loads(request.content)
        return httpx.Response(200, json={"id": "p1"})

    client = _make_client(handler)
    await client.synthesize_segment("p1", "c1", "s1")
    assert seen["json"]["params"] is None


@pytest.mark.asyncio
async def test_scaffold_remotion_posts_body():
    import json as _json

    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = request.url.path
        seen["json"] = _json.loads(request.content)
        return httpx.Response(200, json={"project_dir": "/tmp/x", "created": True, "chapters": 2})

    client = _make_client(handler)
    result = await client.scaffold_remotion("p1", target_dir="/tmp/x")
    assert seen["url"] == "/api/segmented-projects/p1/scaffold-remotion"
    assert seen["json"] == {"target_dir": "/tmp/x"}
    assert result["created"] is True


@pytest.mark.asyncio
async def test_scaffold_remotion_default_body_empty():
    """No target_dir → body is an empty object (backend uses stored path)."""
    import json as _json

    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["json"] = _json.loads(request.content)
        return httpx.Response(200, json={"project_dir": "/tmp/x", "created": False, "chapters": 1})

    client = _make_client(handler)
    await client.scaffold_remotion("p1")
    assert seen["json"] == {}


@pytest.mark.asyncio
async def test_apply_animation_spec_posts_items():
    import json as _json

    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = request.url.path
        seen["json"] = _json.loads(request.content)
        return httpx.Response(200, json={
            "theme_updated": False, "segments_updated": 1,
            "segments_skipped": 0, "missing_segment_ids": [],
        })

    client = _make_client(handler)
    items = [{"segment_id": "s1", "narration_text": "t"}]
    result = await client.apply_animation_spec("p1", items)
    assert seen["url"] == "/api/segmented-projects/p1/apply-animation-spec"
    assert seen["json"] == {"theme": None, "segments": items}
    assert result["segments_updated"] == 1
