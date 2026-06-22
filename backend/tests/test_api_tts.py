from app.models.voice_profile import VoiceProfile


def test_list_default_voices(client):
    """当前 /api/tts/voices 返回本地已克隆的 Qwen voices；空库时为空。"""
    response = client.get("/api/tts/voices")
    assert response.status_code == 200
    data = response.json()
    assert data == {"voices": []}


def test_list_cloned_qwen_voices(client, db_session):
    voice = VoiceProfile(
        id="v1",
        name="Narrator",
        audio_path="/tmp/narrator.wav",
        is_cloned=True,
        qwen_voice_id="cosyvoice-v3-narrator",
        clone_engine="qwen",
    )
    db_session.add(voice)
    db_session.commit()

    response = client.get("/api/tts/voices")
    assert response.status_code == 200
    voices = response.json()["voices"]
    assert len(voices) == 1
    assert voices[0]["id"] == "v1"
    assert voices[0]["qwen_voice_id"] == "cosyvoice-v3-narrator"


def test_list_edge_voices(client, mock_edge_tts_service):
    response = client.get("/api/tts/edge-voices")
    assert response.status_code == 200
    data = response.json()
    assert "voices" in data
    assert len(data["voices"]) == 2
    assert data["voices"][0]["short_name"] == "zh-CN-XiaoxiaoNeural"


def test_list_edge_voices_with_filter(client, mock_edge_tts_service):
    response = client.get("/api/tts/edge-voices?language=Chinese")
    assert response.status_code == 200
    mock_edge_tts_service.list_voices.assert_called_with(language="Chinese", gender=None)


def test_list_edge_languages(client, mock_edge_tts_service):
    response = client.get("/api/tts/edge-languages")
    assert response.status_code == 200
    data = response.json()
    assert "languages" in data
    assert "Chinese" in data["languages"]


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
