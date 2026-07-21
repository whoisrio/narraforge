"""Tests for BackendClient - the agent's only HTTP contract with the backend."""
import pytest

from app.backend_client import BackendClient
from app.schemas import ChapterStructure, Segment, SegmentChapters


@pytest.mark.asyncio
async def test_get_project_calls_correct_url(httpx_mock):
    httpx_mock.add_response(
        url="http://test:8002/api/segmented-projects/p1", json={"id": "p1", "name": "n"}
    )
    c = BackendClient("http://test:8002")
    proj = await c.get_project("p1")
    assert proj["id"] == "p1"
    await c.close()


@pytest.mark.asyncio
async def test_batch_create_structure_posts_and_returns_ids(httpx_mock):
    httpx_mock.add_response(
        method="POST",
        url="http://test:8002/api/segmented-projects/p1/chapters:batch",
        json={"chapters": [{"id": "ch1", "segments": [{"id": "s1"}]}]},
    )
    c = BackendClient("http://test:8002")
    sc = SegmentChapters(
        chapters=[ChapterStructure(chapter_title="c", segments=[Segment(text="t")])]
    )
    result = await c.batch_create_structure("p1", sc)
    assert result[0].id == "ch1"
    assert result[0].segments[0].id == "s1"
    await c.close()


@pytest.mark.asyncio
async def test_synthesize_segment_posts(httpx_mock):
    httpx_mock.add_response(
        method="POST",
        url="http://test:8002/api/segmented-projects/p1/chapters/ch1/segments/s1/synthesize",
        json={},
    )
    c = BackendClient("http://test:8002")
    await c.synthesize_segment("p1", "ch1", "s1")  # no raise
    await c.close()


@pytest.mark.asyncio
async def test_get_project_raises_on_404(httpx_mock):
    httpx_mock.add_response(
        url="http://test:8002/api/segmented-projects/nope", status_code=404
    )
    c = BackendClient("http://test:8002")
    with pytest.raises(Exception):
        await c.get_project("nope")
    await c.close()
