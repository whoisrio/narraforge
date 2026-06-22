from app.core.system_config_service import set_storage_mode


def test_transcribe_success_frontend_storage(client, sample_audio_file, mock_voice_to_srt):
    """默认 frontend storage：返回内容，不落后端下载 URL。"""
    with open(sample_audio_file, "rb") as f:
        response = client.post(
            "/api/speech-to-text/transcribe",
            files={"file": ("test.wav", f, "audio/wav")},
            data={"model_size": "tiny", "beam_size": "1"},
        )
    assert response.status_code == 200
    data = response.json()
    assert "file_id" in data
    assert data["content"].startswith("1\n00:00:01,000")
    assert data["filename"] == "test_20260521_143052.srt"
    assert data["language"] == "en"
    assert data["language_probability"] == 0.98
    assert data["download_url"] is None


def test_transcribe_unsupported_format(client):
    response = client.post(
        "/api/speech-to-text/transcribe",
        files={"file": ("test.txt", b"hello", "text/plain")},
    )
    assert response.status_code == 400


def test_download_not_found(client):
    response = client.get("/api/speech-to-text/download/nonexistent-id")
    assert response.status_code == 404


def test_history_empty_initially(client, mock_voice_to_srt):
    response = client.get("/api/speech-to-text/history")
    assert response.status_code == 200
    assert response.json() == {"results": []}


def test_frontend_storage_does_not_create_history_record(client, mock_voice_to_srt, sample_audio_file):
    with open(sample_audio_file, "rb") as f:
        response = client.post(
            "/api/speech-to-text/transcribe",
            files={"file": ("test.wav", f, "audio/wav")},
            data={"model_size": "large-v3", "beam_size": "5"},
        )
    assert response.status_code == 200

    response = client.get("/api/speech-to-text/history")
    assert response.status_code == 200
    assert response.json()["results"] == []


def test_backend_storage_creates_history_record(client, db_session, mock_voice_to_srt, sample_audio_file):
    set_storage_mode(db_session, "backend")
    db_session.commit()

    with open(sample_audio_file, "rb") as f:
        response = client.post(
            "/api/speech-to-text/transcribe",
            files={"file": ("test.wav", f, "audio/wav")},
            data={"model_size": "large-v3", "beam_size": "5"},
        )
    assert response.status_code == 200
    assert response.json()["download_url"].startswith("/api/speech-to-text/download/")

    response = client.get("/api/speech-to-text/history")
    assert response.status_code == 200
    results = response.json()["results"]
    assert len(results) == 1
    record = results[0]
    assert record["original_filename"] == "test.wav"
    assert record["language"] == "en"
    assert record["model_size"] == "large-v3"


def test_delete_history_record(client, db_session, mock_voice_to_srt, sample_audio_file):
    set_storage_mode(db_session, "backend")
    db_session.commit()

    with open(sample_audio_file, "rb") as f:
        response = client.post(
            "/api/speech-to-text/transcribe",
            files={"file": ("test.wav", f, "audio/wav")},
            data={"model_size": "large-v3", "beam_size": "5"},
        )
    assert response.status_code == 200

    response = client.get("/api/speech-to-text/history")
    record_id = response.json()["results"][0]["id"]

    response = client.delete(f"/api/speech-to-text/history/{record_id}")
    assert response.status_code == 200

    response = client.get("/api/speech-to-text/history")
    assert response.json()["results"] == []


def test_delete_nonexistent_record(client, mock_voice_to_srt):
    response = client.delete("/api/speech-to-text/history/nonexistent-id")
    assert response.status_code == 404


def test_history_limit_enforced(client, db_session, mock_voice_to_srt, sample_audio_file):
    set_storage_mode(db_session, "backend")
    db_session.commit()

    for _ in range(11):
        with open(sample_audio_file, "rb") as f:
            response = client.post(
                "/api/speech-to-text/transcribe",
                files={"file": ("test.wav", f, "audio/wav")},
                data={"model_size": "large-v3", "beam_size": "5"},
            )
        assert response.status_code == 200

    response = client.get("/api/speech-to-text/history")
    assert response.status_code == 200
    results = response.json()["results"]
    assert len(results) == 10
