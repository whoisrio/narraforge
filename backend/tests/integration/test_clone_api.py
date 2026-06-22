"""Voice Clone API 集成测试"""
import os
import tempfile
import pytest
from unittest.mock import patch, AsyncMock
from fastapi.testclient import TestClient


class TestCloneAPI:

    def test_root_endpoint(self, client: TestClient):
        response = client.get("/")
        assert response.status_code == 200
        data = response.json()
        assert data["message"] == "Voice Clone Studio API"

    def test_health_endpoint(self, client: TestClient):
        response = client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"

    def test_upload_voice_success(self, client: TestClient, mock_tts_service, sample_audio_file):
        with open(sample_audio_file, "rb") as audio_file:
            files = {"file": ("test_audio.wav", audio_file, "audio/wav")}
            response = client.post("/api/clone/upload", files=files)

        assert response.status_code == 200
        data = response.json()
        assert "id" in data
        assert "name" in data
        assert "audio_url" in data
        assert data["is_cloned"] is False
        assert data["name"] == "test_audio.wav"

    def test_upload_voice_no_file(self, client: TestClient):
        response = client.post("/api/clone/upload")
        assert response.status_code == 422

    def test_upload_voice_invalid_file_type(self, client: TestClient):
        """上传 .txt 文件应返回 400"""
        temp_file = tempfile.NamedTemporaryFile(suffix=".txt", delete=False)
        temp_file.write(b"This is a text file, not audio")
        temp_file.close()

        with open(temp_file.name, "rb") as file:
            files = {"file": ("test.txt", file, "text/plain")}
            response = client.post("/api/clone/upload", files=files)

        os.unlink(temp_file.name)

        assert response.status_code == 400

    def test_list_voices_empty(self, client: TestClient):
        response = client.get("/api/clone/list")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) == 0

    def test_list_voices_with_data(self, client: TestClient, db_session):
        from app.models.voice_profile import VoiceProfile
        import uuid
        from datetime import datetime, timezone

        voice1 = VoiceProfile(
            id=str(uuid.uuid4()),
            name="Voice 1",
            audio_path="/tmp/voice1.wav",
            created_at=datetime.now(timezone.utc)
        )
        voice2 = VoiceProfile(
            id=str(uuid.uuid4()),
            name="Voice 2",
            audio_path="/tmp/voice2.wav",
            is_cloned=True,
            qwen_voice_id="cloned_123",
            cloned_at=datetime.now(timezone.utc),
            created_at=datetime.now(timezone.utc)
        )

        db_session.add_all([voice1, voice2])
        db_session.commit()

        response = client.get("/api/clone/list")
        assert response.status_code == 200
        data = response.json()

        assert isinstance(data, list)
        assert len(data) == 2

        voice1_data = next(v for v in data if v["name"] == "Voice 1")
        voice2_data = next(v for v in data if v["name"] == "Voice 2")

        assert voice1_data["is_cloned"] is False
        assert voice1_data["qwen_voice_id"] is None
        assert voice1_data["cloned_at"] is None

        assert voice2_data["is_cloned"] is True
        assert voice2_data["qwen_voice_id"] == "cloned_123"
        assert voice2_data["cloned_at"] is not None

    def test_get_voice_not_found(self, client: TestClient):
        response = client.get("/api/clone/nonexistent_voice_id")
        assert response.status_code == 404

    def test_get_voice_success(self, client: TestClient, db_session):
        from app.models.voice_profile import VoiceProfile
        import uuid
        from datetime import datetime, timezone

        voice_id = str(uuid.uuid4())
        voice = VoiceProfile(
            id=voice_id,
            name="Test Voice",
            audio_path="/tmp/test.wav",
            is_cloned=True,
            qwen_voice_id="cloned_456",
            cloned_at=datetime.now(timezone.utc),
            created_at=datetime.now(timezone.utc)
        )

        db_session.add(voice)
        db_session.commit()

        response = client.get(f"/api/clone/{voice_id}")
        assert response.status_code == 200
        data = response.json()

        assert data["id"] == voice_id
        assert data["name"] == "Test Voice"
        assert data["audio_url"] == f"/api/clone/audio/{voice_id}"
        assert data["is_cloned"] is True
        assert data["qwen_voice_id"] == "cloned_456"
        assert data["cloned_at"] is not None
        assert data["created_at"] is not None

    def test_delete_voice_success(self, client: TestClient, db_session):
        """测试删除声音成功"""
        from app.models.voice_profile import VoiceProfile
        import uuid

        voice_id = str(uuid.uuid4())
        # 使用跨平台临时目录
        audio_path = os.path.join(tempfile.gettempdir(), f"delete_test_{voice_id}.wav")

        with open(audio_path, "w") as f:
            f.write("dummy audio data")

        voice = VoiceProfile(
            id=voice_id,
            name="Delete Test",
            audio_path=audio_path,
        )

        db_session.add(voice)
        db_session.commit()

        assert os.path.exists(audio_path)

        response = client.delete(f"/api/clone/{voice_id}")
        assert response.status_code == 200
        data = response.json()
        assert "deleted" in data["message"].lower()

        assert not os.path.exists(audio_path)

        response = client.get(f"/api/clone/{voice_id}")
        assert response.status_code == 404

    def test_delete_voice_not_found(self, client: TestClient):
        response = client.delete("/api/clone/nonexistent_id")
        assert response.status_code == 404

    def test_create_clone_success(self, client: TestClient, db_session, mock_tts_service):
        """测试创建克隆声音成功：本地音频会先上传为公网 URL，再注册到 Qwen。"""
        from app.models.voice_profile import VoiceProfile
        import uuid

        voice_id = str(uuid.uuid4())
        audio_path = os.path.join(tempfile.gettempdir(), f"clone_test_{voice_id}.wav")

        with open(audio_path, "w") as f:
            f.write("dummy audio data")

        voice = VoiceProfile(
            id=voice_id,
            name="Clone Test",
            audio_path=audio_path,
        )

        db_session.add(voice)
        db_session.commit()

        mock_tts_service.register_cloned_voice.return_value = {
            "voice_id": "qwen_cloned_123",
            "voice_name": "Cloned Voice",
            "role": "custom"
        }

        public_url = "https://cdn.example.com/clone.wav"
        request_data = {
            "voice_id": voice_id,
            "name": "Cloned Voice Name",
            "role": "custom"
        }

        with patch("app.api.clone.upload_to_qiniu", return_value=public_url):
            response = client.post("/api/clone/create-clone", json=request_data)

        assert response.status_code == 200
        data = response.json()

        assert data["id"] == voice_id
        assert data["name"] == "Cloned Voice Name"
        assert data["qwen_voice_id"] == "qwen_cloned_123"
        assert data["role"] == "custom"
        assert data["is_cloned"] is True
        assert data["cloned_at"] is not None

        mock_tts_service.register_cloned_voice.assert_called_once_with(
            reference_audio_path=public_url,
            voice_name="Cloned Voice Name"
        )

        if os.path.exists(audio_path):
            os.unlink(audio_path)

    def test_create_clone_voice_not_found(self, client: TestClient):
        request_data = {
            "voice_id": "nonexistent_voice",
            "name": "Test Voice"
        }

        response = client.post("/api/clone/create-clone", json=request_data)
        assert response.status_code == 404

    def test_create_clone_audio_file_not_found(self, client: TestClient, db_session):
        """测试音频文件不存在时创建克隆"""
        from app.models.voice_profile import VoiceProfile
        import uuid

        voice_id = str(uuid.uuid4())
        voice = VoiceProfile(
            id=voice_id,
            name="Missing Audio",
            audio_path=os.path.join(tempfile.gettempdir(), f"nonexistent_{voice_id}.wav"),
        )

        db_session.add(voice)
        db_session.commit()

        request_data = {
            "voice_id": voice_id,
            "name": "Test Voice"
        }

        response = client.post("/api/clone/create-clone", json=request_data)
        assert response.status_code == 404

    def test_get_cloned_audio_not_found(self, client: TestClient):
        response = client.get("/api/clone/cloned_audio/nonexistent_audio")
        assert response.status_code == 404
