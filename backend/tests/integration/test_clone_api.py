"""
Voice Clone API 集成测试
"""
import pytest
import json
from unittest.mock import patch, AsyncMock
from fastapi.testclient import TestClient


class TestCloneAPI:
    """Voice Clone API 测试类"""

    def test_root_endpoint(self, client: TestClient):
        """测试根端点"""
        response = client.get("/")
        assert response.status_code == 200
        data = response.json()
        assert "message" in data
        assert "version" in data
        assert data["message"] == "Voice Clone Studio API"

    def test_health_endpoint(self, client: TestClient):
        """测试健康检查端点"""
        response = client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert "status" in data
        assert data["status"] == "healthy"

    def test_upload_voice_success(self, client: TestClient, mock_tts_service, sample_audio_file):
        """测试上传音频文件成功"""
        # 准备测试文件
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
        """测试没有文件上传"""
        response = client.post("/api/clone/upload")
        assert response.status_code == 422  # 422 Unprocessable Entity

    def test_upload_voice_invalid_file_type(self, client: TestClient):
        """测试上传无效文件类型"""
        # 创建文本文件而不是音频文件
        import tempfile
        temp_file = tempfile.NamedTemporaryFile(suffix=".txt", delete=False)
        temp_file.write(b"This is a text file, not audio")
        temp_file.close()

        with open(temp_file.name, "rb") as file:
            files = {"file": ("test.txt", file, "text/plain")}
            response = client.post("/api/clone/upload", files=files)

        import os
        os.unlink(temp_file.name)

        # 虽然文件类型不对，但API应该接受（实际验证在业务逻辑中）
        assert response.status_code == 200

    def test_list_voices_empty(self, client: TestClient):
        """测试获取空声音列表"""
        response = client.get("/api/clone/list")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) == 0

    def test_list_voices_with_data(self, client: TestClient, db_session):
        """测试获取有数据的声音列表"""
        # 创建测试数据
        from app.models.voice_profile import VoiceProfile
        import uuid
        from datetime import datetime

        voice1 = VoiceProfile(
            id=str(uuid.uuid4()),
            name="Voice 1",
            audio_path="/tmp/voice1.wav",
            created_at=datetime.utcnow()
        )
        voice2 = VoiceProfile(
            id=str(uuid.uuid4()),
            name="Voice 2",
            audio_path="/tmp/voice2.wav",
            is_cloned=True,
            qwen_voice_id="cloned_123",
            cloned_at=datetime.utcnow(),
            created_at=datetime.utcnow()
        )

        db_session.add_all([voice1, voice2])
        db_session.commit()

        response = client.get("/api/clone/list")
        assert response.status_code == 200
        data = response.json()

        assert isinstance(data, list)
        assert len(data) == 2

        # 验证数据
        voice1_data = next(v for v in data if v["name"] == "Voice 1")
        voice2_data = next(v for v in data if v["name"] == "Voice 2")

        assert voice1_data["is_cloned"] is False
        assert voice1_data["qwen_voice_id"] is None
        assert voice1_data["cloned_at"] is None

        assert voice2_data["is_cloned"] is True
        assert voice2_data["qwen_voice_id"] == "cloned_123"
        assert voice2_data["cloned_at"] is not None

    def test_get_voice_not_found(self, client: TestClient):
        """测试获取不存在的单个声音"""
        response = client.get("/api/clone/nonexistent_voice_id")
        assert response.status_code == 404
        data = response.json()
        assert "detail" in data
        assert "not found" in data["detail"].lower()

    def test_get_voice_success(self, client: TestClient, db_session):
        """测试获取单个声音成功"""
        from app.models.voice_profile import VoiceProfile
        import uuid
        from datetime import datetime

        voice_id = str(uuid.uuid4())
        voice = VoiceProfile(
            id=voice_id,
            name="Test Voice",
            audio_path="/tmp/test.wav",
            is_cloned=True,
            qwen_voice_id="cloned_456",
            cloned_at=datetime.utcnow(),
            created_at=datetime.utcnow()
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
        import os

        voice_id = str(uuid.uuid4())
        audio_path = "/tmp/delete_test.wav"

        # 创建测试文件
        with open(audio_path, "w") as f:
            f.write("dummy audio data")

        voice = VoiceProfile(
            id=voice_id,
            name="Delete Test",
            audio_path=audio_path,
            created_at=datetime.utcnow()
        )

        db_session.add(voice)
        db_session.commit()

        # 验证文件存在
        assert os.path.exists(audio_path)

        # 删除
        response = client.delete(f"/api/clone/{voice_id}")
        assert response.status_code == 200
        data = response.json()
        assert "message" in data
        assert "deleted" in data["message"].lower()

        # 验证文件被删除
        assert not os.path.exists(audio_path)

        # 验证数据库记录被删除
        from datetime import datetime
        response = client.get(f"/api/clone/{voice_id}")
        assert response.status_code == 404

    def test_delete_voice_not_found(self, client: TestClient):
        """测试删除不存在的声音"""
        response = client.delete("/api/clone/nonexistent_id")
        assert response.status_code == 404

    def test_create_clone_success(self, client: TestClient, db_session, mock_tts_service):
        """测试创建克隆声音成功"""
        from app.models.voice_profile import VoiceProfile
        import uuid
        import os

        voice_id = str(uuid.uuid4())
        audio_path = "/tmp/clone_test.wav"

        # 创建测试音频文件
        with open(audio_path, "w") as f:
            f.write("dummy audio data")

        voice = VoiceProfile(
            id=voice_id,
            name="Clone Test",
            audio_path=audio_path,
            created_at=datetime.utcnow()
        )

        db_session.add(voice)
        db_session.commit()

        # 配置模拟服务
        mock_tts_service.register_cloned_voice.return_value = {
            "voice_id": "qwen_cloned_123",
            "voice_name": "Cloned Voice",
            "role": "custom"
        }

        # 创建克隆
        request_data = {
            "voice_id": voice_id,
            "name": "Cloned Voice Name",
            "role": "custom"
        }

        response = client.post(
            "/api/clone/create-clone",
            json=request_data
        )

        assert response.status_code == 200
        data = response.json()

        assert data["id"] == voice_id
        assert data["name"] == "Cloned Voice Name"
        assert data["qwen_voice_id"] == "qwen_cloned_123"
        assert data["role"] == "custom"
        assert data["is_cloned"] is True
        assert data["cloned_at"] is not None

        # 验证模拟服务被调用
        mock_tts_service.register_cloned_voice.assert_called_once_with(
            reference_audio_path=audio_path,
            voice_name="Cloned Voice Name"
        )

        # 清理
        if os.path.exists(audio_path):
            os.unlink(audio_path)

    def test_create_clone_voice_not_found(self, client: TestClient):
        """测试为不存在的声音创建克隆"""
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
        from datetime import datetime

        voice_id = str(uuid.uuid4())
        voice = VoiceProfile(
            id=voice_id,
            name="Missing Audio",
            audio_path="/tmp/nonexistent_audio.wav",  # 不存在的文件
            created_at=datetime.utcnow()
        )

        db_session.add(voice)
        db_session.commit()

        request_data = {
            "voice_id": voice_id,
            "name": "Test Voice"
        }

        response = client.post("/api/clone/create-clone", json=request_data)
        assert response.status_code == 404
        data = response.json()
        assert "not found" in data["detail"].lower()

    def test_clone_synthesize_success(self, client: TestClient, db_session, mock_tts_service):
        """测试使用克隆声音合成成功"""
        from app.models.voice_profile import VoiceProfile
        import uuid
        from datetime import datetime

        voice_id = str(uuid.uuid4())
        qwen_voice_id = "qwen_cloned_789"

        voice = VoiceProfile(
            id=voice_id,
            name="Synthesize Test",
            audio_path="/tmp/test.wav",
            is_cloned=True,
            qwen_voice_id=qwen_voice_id,
            cloned_at=datetime.utcnow(),
            created_at=datetime.utcnow()
        )

        db_session.add(voice)
        db_session.commit()

        # 配置模拟服务
        mock_tts_service.clone_voice.return_value = b"synthesized_audio_data"

        request_data = {
            "voice_id": voice_id,
            "text": "Hello from cloned voice!",
            "speed": 1.2,
            "volume": 90,
            "pitch": 2
        }

        response = client.post("/api/clone/synthesize", json=request_data)
        assert response.status_code == 200
        data = response.json()

        assert "audio_id" in data
        assert "audio_url" in data
        assert data["text"] == "Hello from cloned voice!"
        assert data["voice_id"] == qwen_voice_id
        assert data["params"]["speed"] == 1.2
        assert data["params"]["volume"] == 90
        assert data["params"]["pitch"] == 2

        # 验证模拟服务被调用
        mock_tts_service.clone_voice.assert_called_once_with(
            voice_id=qwen_voice_id,
            text="Hello from cloned voice!",
            speed=1.2,
            volume=90,
            pitch=2,
            format="wav",
            sample_rate=16000
        )

    def test_clone_synthesize_voice_not_found(self, client: TestClient):
        """测试使用不存在的克隆声音合成"""
        request_data = {
            "voice_id": "nonexistent_voice",
            "text": "Hello"
        }

        response = client.post("/api/clone/synthesize", json=request_data)
        assert response.status_code == 404

    def test_clone_synthesize_not_cloned(self, client: TestClient, db_session):
        """测试使用未克隆的声音合成"""
        from app.models.voice_profile import VoiceProfile
        import uuid
        from datetime import datetime

        voice_id = str(uuid.uuid4())

        voice = VoiceProfile(
            id=voice_id,
            name="Not Cloned",
            audio_path="/tmp/test.wav",
            is_cloned=False,  # 未克隆
            qwen_voice_id=None,
            created_at=datetime.utcnow()
        )

        db_session.add(voice)
        db_session.commit()

        request_data = {
            "voice_id": voice_id,
            "text": "Hello"
        }

        response = client.post("/api/clone/synthesize", json=request_data)
        assert response.status_code == 400
        data = response.json()
        assert "not registered" in data["detail"].lower()

    def test_get_cloned_audio_not_found(self, client: TestClient):
        """测试获取不存在的克隆音频"""
        response = client.get("/api/clone/cloned_audio/nonexistent_audio")
        assert response.status_code == 404

    @pytest.mark.parametrize("invalid_data", [
        {},  # 空对象
        {"voice_id": ""},  # 空 voice_id
        {"voice_id": "test", "text": ""},  # 空文本
        {"voice_id": "test", "text": "a" * 1001},  # 超长文本（假设有长度限制）
    ])
    def test_clone_synthesize_invalid_data(self, client: TestClient, invalid_data):
        """测试使用无效数据合成"""
        response = client.post("/api/clone/synthesize", json=invalid_data)
        # 可能是 422（验证错误）或 400（业务逻辑错误）
        assert response.status_code in [400, 422]