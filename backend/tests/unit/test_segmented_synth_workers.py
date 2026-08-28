"""workers 版分段项目音频（Supabase Storage）单测。

mock 仓储（sync）+ 资产存储（async）+ edge-tts 合成，验证：
- synthesize：edge-tts 音频进 store、segment audio.path 写 ref、save_project 收到更新；
- 非 edge-tts 引擎报 422（workers 只支持 edge_tts）；
- 录音上传：原样存 + origin='recorded' 锁定；
- 读取：从 store.get 返回音频字节。
"""
import pytest
from unittest.mock import AsyncMock, MagicMock

from app.services import segmented_synth_workers as w


def _project(seg_audio=None):
    return {
        "id": "p1",
        "name": "项目",
        "schema_version": 2,
        "layout": "vertical",
        "active_chapter_id": "c1",
        "configs": {},
        "chapters": [{
            "id": "c1",
            "position": 0,
            "name": "第一章",
            "voice": {"engine": "edge_tts", "params": {"edge_voice": "zh-CN-XiaoxiaoNeural"}},
            "split_config": {"delimiters": ["。"], "mode": "rule"},
            "segments": [{
                "id": "s1",
                "position": 0,
                "text": "第一段",
                "voice": {"source": "chapter"},
                "status": "idle",
                "audio": seg_audio,
            }],
        }],
    }


def _repo(project):
    repo = MagicMock()
    repo.get_project.return_value = project  # dict 形状
    repo.save_project.side_effect = lambda proj: proj  # 原样返回 ProjectIn
    return repo


def _store():
    store = MagicMock()
    store.put = AsyncMock(return_value="data/segments/p1/c1/s1.mp3")
    store.get = AsyncMock(return_value=b"MP3DATA")
    return store


@pytest.mark.asyncio
async def test_synthesize_edge_tts_stores_audio(monkeypatch):
    project = _project()
    repo = _repo(project)
    store = _store()

    def _synth_internal(**kwargs):
        # synthesize_speech_internal 是 sync 函数（内部 _run_async 桥接）
        return b"MP3BYTES", "mp3"

    monkeypatch.setattr("app.api.tts.synthesize_speech_internal", _synth_internal)

    detail = await w.synthesize_segment_workers(
        repo, store,
        project_id="p1", chapter_id="c1", segment_id="s1",
        request_params=None, text_override=None, ssml_override=None,
        keep_previous=True, force=False,
    )

    # 音频进 asset store，key 带项目/章节/段
    store.put.assert_awaited_once()
    key = store.put.await_args.args[0]
    assert key == "data/segments/p1/c1/s1.mp3"

    # save_project 收到更新后的项目：segment audio.current.path = ref
    saved = repo.save_project.call_args.args[0]
    seg = saved.chapters[0].segments[0]
    assert seg.audio["current"]["path"] == "data/segments/p1/c1/s1.mp3"
    assert seg.audio["current"]["origin"] == "tts"
    assert detail is project or detail is not None


@pytest.mark.asyncio
async def test_synthesize_mimo_tts(monkeypatch):
    project = _project()
    project["chapters"][0]["voice"] = {
        "engine": "mimo_tts",
        "params": {"mimo_mode": "preset", "mimo_preset_voice": "bingbing"},
    }
    repo = _repo(project)
    store = _store()

    def _synth_mimo_internal(**kwargs):
        return b"MIMOBYTES", "mp3"

    monkeypatch.setattr("app.api.mimo_tts.synthesize_mimo_internal", _synth_mimo_internal)

    await w.synthesize_segment_workers(
        repo, store,
        project_id="p1", chapter_id="c1", segment_id="s1",
        request_params=None, text_override=None, ssml_override=None,
        keep_previous=True, force=False,
    )

    store.put.assert_awaited_once()
    saved = repo.save_project.call_args.args[0]
    seg = saved.chapters[0].segments[0]
    assert seg.audio["current"]["path"] == "data/segments/p1/c1/s1.mp3"
    assert seg.audio["current"]["origin"] == "tts"


@pytest.mark.asyncio
async def test_synthesize_engine_not_supported(monkeypatch):
    project = _project()
    project["chapters"][0]["voice"] = {"engine": "cosyvoice", "params": {"voice_id": "v1"}}
    repo = _repo(project)
    store = _store()

    with pytest.raises(ValueError, match="not supported in workers"):
        await w.synthesize_segment_workers(
            repo, store,
            project_id="p1", chapter_id="c1", segment_id="s1",
            request_params=None, text_override=None, ssml_override=None,
            keep_previous=True, force=False,
        )
    store.put.assert_not_awaited()


@pytest.mark.asyncio
async def test_synthesize_respects_recorded_lock(monkeypatch):
    project = _project(seg_audio={"current": {"path": "x.mp3", "origin": "recorded"}})
    repo = _repo(project)
    store = _store()

    detail = await w.synthesize_segment_workers(
        repo, store,
        project_id="p1", chapter_id="c1", segment_id="s1",
        request_params=None, text_override=None, ssml_override=None,
        keep_previous=True, force=False,
    )
    store.put.assert_not_awaited()
    repo.save_project.assert_not_called()
    assert detail is not None


@pytest.mark.asyncio
async def test_upload_recorded_audio():
    project = _project()
    repo = _repo(project)
    store = _store()

    detail = await w.upload_segment_audio_workers(
        repo, store,
        project_id="p1", chapter_id="c1", segment_id="s1",
        audio_bytes=b"REC", filename="rec.webm", duration_sec=1.5,
    )

    store.put.assert_awaited_once()
    saved = repo.save_project.call_args.args[0]
    seg = saved.chapters[0].segments[0]
    assert seg.audio["current"]["origin"] == "recorded"
    assert seg.audio["current"]["duration_sec"] == 1.5


@pytest.mark.asyncio
async def test_get_audio_reads_from_store():
    project = _project(seg_audio={"current": {"path": "data/segments/p1/c1/s1.mp3"}})
    repo = _repo(project)
    store = _store()

    data = await w.get_segment_audio_workers(
        repo, store,
        project_id="p1", chapter_id="c1", segment_id="s1",
    )
    assert data == b"MP3DATA"
    store.get.assert_awaited_once_with("data/segments/p1/c1/s1.mp3")


@pytest.mark.asyncio
async def test_get_audio_missing_ref_returns_none():
    project = _project()  # 无 audio
    repo = _repo(project)
    store = _store()

    data = await w.get_segment_audio_workers(
        repo, store,
        project_id="p1", chapter_id="c1", segment_id="s1",
    )
    assert data is None
    store.get.assert_not_awaited()


def _capture_edge_text(monkeypatch):
    """patch edge-tts 合成，返回 captured dict（合成后读 captured["text"]）。"""
    captured: dict = {}

    def _synth_internal(**kwargs):
        captured["text"] = kwargs["text"]
        return b"MP3BYTES", "mp3"

    monkeypatch.setattr("app.api.tts.synthesize_speech_internal", _synth_internal)
    return captured


@pytest.mark.asyncio
async def test_synthesize_applies_transforms_apply_all(monkeypatch):
    project = _project()
    project["configs"] = {
        "pronunciation_map": [{"id": "pm_1", "source": "调动", "target": "掉动"}],
        "pronunciation_apply_all": True,
        "lowercase_latin": True,
    }
    project["chapters"][0]["segments"][0]["text"] = "调动 REST API"
    repo = _repo(project)
    store = _store()
    captured = _capture_edge_text(monkeypatch)
    monkeypatch.setattr(w, "_load_global_map", lambda: [])

    await w.synthesize_segment_workers(
        repo, store,
        project_id="p1", chapter_id="c1", segment_id="s1",
        request_params=None, text_override=None, ssml_override=None,
        keep_previous=True, force=False,
    )

    assert captured["text"] == "掉动 rest api"
    saved = repo.save_project.call_args.args[0]
    seg = saved.chapters[0].segments[0]
    assert seg.generated_params["effective_text"] == "掉动 rest api"


@pytest.mark.asyncio
async def test_synthesize_applies_global_map_via_segment_ids(monkeypatch):
    project = _project()  # seg text = "第一段"
    project["chapters"][0]["segments"][0]["text_transforms"] = {
        "applied_map_ids": ["gpm_1"],
    }
    repo = _repo(project)
    store = _store()
    captured = _capture_edge_text(monkeypatch)
    monkeypatch.setattr(
        w, "_load_global_map",
        lambda: [{"id": "gpm_1", "source": "第一段", "target": "开篇"}],
    )

    await w.synthesize_segment_workers(
        repo, store,
        project_id="p1", chapter_id="c1", segment_id="s1",
        request_params=None, text_override=None, ssml_override=None,
        keep_previous=True, force=False,
    )

    assert captured["text"] == "开篇"


@pytest.mark.asyncio
async def test_synthesize_workers_preserves_text_transforms_on_save(monkeypatch):
    """text_transforms 随 workers 全量写回透传（_to_project_in → SegmentIn）。"""
    project = _project()
    tt = {"applied_map_ids": ["pm_x"], "lowercase_latin": False}
    project["chapters"][0]["segments"][0]["text_transforms"] = tt
    repo = _repo(project)
    store = _store()
    _capture_edge_text(monkeypatch)
    monkeypatch.setattr(w, "_load_global_map", lambda: [])

    await w.synthesize_segment_workers(
        repo, store,
        project_id="p1", chapter_id="c1", segment_id="s1",
        request_params=None, text_override=None, ssml_override=None,
        keep_previous=True, force=False,
    )

    saved = repo.save_project.call_args.args[0]
    assert saved.chapters[0].segments[0].text_transforms == tt
