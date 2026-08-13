import asyncio
import base64

from app.models.voice_profile import VoiceProfile


def test_list_default_voices(client):
    """当前 /api/tts/voices 返回本地已克隆的 Qwen voices；空库时为空。"""
    response = client.get("/api/tts/voices")
    assert response.status_code == 200
    data = response.json()
    assert data == {"items": []}


def test_list_cloned_qwen_voices(client, db_session):
    voice = VoiceProfile(
        id="v1",
        name="Narrator",
        voice={"model": "cosyvoice", "voice_type": "clone"},
        voice_params={"cosyvoice": {"source_audio_path": "/tmp/narrator.wav", "params": {"voice_id": "cosyvoice-v3-narrator"}}},
    )
    db_session.add(voice)
    db_session.commit()

    response = client.get("/api/tts/voices")
    assert response.status_code == 200
    voices = response.json()["items"]
    assert len(voices) == 1
    assert voices[0]["id"] == "v1"
    assert voices[0]["voice_params"]["cosyvoice"]["params"]["voice_id"] == "cosyvoice-v3-narrator"


def test_list_edge_voices(client, mock_edge_tts_service):
    response = client.get("/api/tts/edge-voices")
    assert response.status_code == 200
    data = response.json()
    assert "items" in data
    assert len(data["items"]) == 2
    assert data["items"][0]["short_name"] == "zh-CN-XiaoxiaoNeural"


def test_list_edge_voices_with_filter(client, mock_edge_tts_service):
    response = client.get("/api/tts/edge-voices?language=Chinese")
    assert response.status_code == 200
    mock_edge_tts_service.list_voices.assert_called_with(language="Chinese", gender=None)


def test_list_edge_languages(client, mock_edge_tts_service):
    response = client.get("/api/tts/edge-languages")
    assert response.status_code == 200
    data = response.json()
    assert "items" in data
    assert "Chinese" in data["items"]


def test_synthesize_with_edge_tts(client, mock_edge_tts_service, db_session):
    response = client.post("/api/tts/synthesize", json={
        "text": "Hello world",
        "engine": "edge_tts",
        "edge_voice": "en-US-GuyNeural",
        "edge_rate": "+0%",
        "edge_volume": "+0%",
    })
    assert response.status_code == 200
    data = response.json()
    assert "audio_id" in data
    assert data["params"]["engine"] == "edge_tts"
    assert data["params"]["edge_voice"] == "en-US-GuyNeural"


def test_synthesize_edge_tts_missing_voice(client, mock_edge_tts_service, db_session):
    response = client.post("/api/tts/synthesize", json={
        "text": "Hello world",
        "engine": "edge_tts",
    })
    assert response.status_code == 400


def test_synthesize_edge_tts_frontend_storage_never_touches_disk(
    mock_edge_tts_service, monkeypatch
):
    """回归：前端存储（workers 只读 FS，is_frontend_storage 恒 True）下
    edge_tts 合成不得落盘——曾在写盘后才判存储模式，Vercel 上
    data/tts-history/ 目录不存在/只读，直接 Errno 2 崩在写盘处。"""
    from unittest.mock import MagicMock

    from app.api.tts import TTSRequest, _synthesize_edge_tts

    monkeypatch.setattr("app.api.tts.is_frontend_storage", lambda db: True)

    # 若实现回退（frontend 分支仍写盘），aiofiles.open 被调用即失败
    async def _fail_if_called(*args, **kwargs):
        raise AssertionError("frontend storage must not write audio to disk")

    monkeypatch.setattr("app.api.tts.aiofiles.open", _fail_if_called)

    result = asyncio.run(_synthesize_edge_tts(
        TTSRequest(text="Hello", engine="edge_tts", edge_voice="en-US-GuyNeural"),
        db=None,
        repo=MagicMock(),  # frontend 分支不触碰仓储/资产存储
        store=MagicMock(),
    ))

    fake_audio = b"\xff\xfb\x90\x00" * 50  # conftest mock_edge_tts_service 的假音频
    assert result["audio_base64"] == base64.b64encode(fake_audio).decode("utf-8")
    assert result["params"]["engine"] == "edge_tts"
    assert result["params"]["edge_voice"] == "en-US-GuyNeural"


def test_synthesize_edge_tts_backend_storage_persists(
    mock_edge_tts_service, monkeypatch, tmp_path, db_session
):
    """后端存储（local + storage_mode=backend）：edge_tts 音频经 asset store
    落盘（Local 写 data/tts-history/），记录经仓储持久化到 tts_results。"""
    from app.api.tts import TTSRequest, _synthesize_edge_tts
    from app.core.asset_store import LocalAssetStore
    from app.core.config import settings
    from app.core.repositories.tts_results import LocalTTSResultRepository
    from app.models.tts_result import TTSResultRecord

    monkeypatch.setattr("app.api.tts.is_frontend_storage", lambda db: False)
    # 隔离 asset store 落盘目录：base_dir 指到 tmp_path（LocalAssetStore 经 resolve_path 拼接）
    monkeypatch.setattr(settings, "base_dir", tmp_path)

    repo = LocalTTSResultRepository(db_session)
    store = LocalAssetStore()

    result = asyncio.run(_synthesize_edge_tts(
        TTSRequest(text="Hello", engine="edge_tts", edge_voice="en-US-GuyNeural"),
        db=db_session,
        repo=repo,
        store=store,
    ))

    # 音频落盘（tmp_path/data/tts-history/tts_{id}.mp3）
    files = list((tmp_path / "data/tts-history").glob(f"tts_{result['audio_id']}.mp3"))
    assert len(files) == 1
    assert files[0].read_bytes() == b"\xff\xfb\x90\x00" * 50

    # DB 记录持久化（audio_path 为相对 base_dir 的 ref）
    record = db_session.query(TTSResultRecord).filter(
        TTSResultRecord.id == result["audio_id"]
    ).first()
    assert record is not None
    assert record.voice_id == "en-US-GuyNeural"
    assert record.audio_path.startswith("data/tts-history/")
    assert result["audio_url"] == f"/api/tts/audio/{result['audio_id']}"
