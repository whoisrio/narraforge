"""
VoiceProfile 模型单元测试
"""
import pytest
from datetime import datetime
from sqlalchemy.exc import IntegrityError

from app.models.voice_profile import VoiceProfile
from app.core.time_utils import utcnow


class TestVoiceProfileModel:
    """VoiceProfile 模型测试类"""

    def test_create_voice_profile(self, db_session):
        """测试创建 VoiceProfile"""
        voice_data = {
            "id": "test_voice_001",
            "name": "Test Voice",
        }

        voice = VoiceProfile(**voice_data)
        db_session.add(voice)
        db_session.commit()

        assert voice.id == "test_voice_001"
        assert voice.name == "Test Voice"
        assert voice.voice == {}
        assert voice.voice_params == {}
        assert isinstance(voice.created_at, datetime)

    def test_voice_profile_required_fields(self, db_session):
        """测试必填字段验证 — name 是唯一必填字段"""
        with pytest.raises(IntegrityError):
            voice = VoiceProfile(
                id="test_voice_002",
            )
            db_session.add(voice)
            db_session.commit()

        db_session.rollback()

        voice = VoiceProfile(
            id="test_voice_003",
            name="Design Only Voice",
        )
        db_session.add(voice)
        db_session.commit()
        assert voice.preview is None

    def test_voice_profile_default_values(self, db_session):
        """测试默认值"""
        voice = VoiceProfile(
            id="test_voice_004",
            name="Test Voice",
        )
        db_session.add(voice)
        db_session.commit()

        assert voice.voice == {}
        assert voice.voice_params == {}
        assert voice.created_at is not None

    def test_voice_profile_string_representation(self, db_session):
        """测试字符串表示"""
        voice = VoiceProfile(
            id="test_voice_006",
            name="Test Voice",
        )
        db_session.add(voice)
        db_session.commit()

        assert "VoiceProfile" in repr(voice)
        assert "test_voice_006" in repr(voice)

    def test_voice_profile_update(self, db_session):
        """测试更新 VoiceProfile"""
        voice = VoiceProfile(
            id="test_voice_007",
            name="Original Name",
        )
        db_session.add(voice)
        db_session.commit()

        voice.name = "Updated Name"
        voice.voice_params = {"cosyvoice": {"source_audio_path": "/tmp/updated_audio.wav", "params": {}}}
        voice.voice = {"model": "cosyvoice", "voice_type": "clone"}
        db_session.commit()

        updated_voice = db_session.query(VoiceProfile).filter_by(id="test_voice_007").first()
        assert updated_voice.name == "Updated Name"
        assert updated_voice.voice_params.get("cosyvoice", {}).get("source_audio_path") == "/tmp/updated_audio.wav"
        assert updated_voice.voice["voice_type"] == "clone"
        assert updated_voice.voice["model"] == "cosyvoice"

    def test_voice_profile_delete(self, db_session):
        """测试删除 VoiceProfile"""
        voice = VoiceProfile(
            id="test_voice_008",
            name="Test Voice",
        )
        db_session.add(voice)
        db_session.commit()

        assert db_session.query(VoiceProfile).filter_by(id="test_voice_008").first() is not None

        db_session.delete(voice)
        db_session.commit()

        assert db_session.query(VoiceProfile).filter_by(id="test_voice_008").first() is None

    def test_voice_profile_created_at_auto_set(self, db_session):
        """测试 created_at 自动设置"""
        import time
        before_create = utcnow()
        time.sleep(0.01)

        voice = VoiceProfile(
            id="test_voice_009",
            name="Test Voice",
        )
        db_session.add(voice)
        db_session.commit()

        time.sleep(0.01)
        after_create = utcnow()

        assert voice.created_at is not None
        assert before_create < voice.created_at < after_create

    def test_voice_profile_cloned_preview_path(self, db_session):
        """preview 字段存储试听音频路径"""
        voice = VoiceProfile(
            id="test_preview_001",
            name="Preview Voice",
            preview={"audition_text": "", "preview_audio_path": "/tmp/preview.wav"},
        )
        db_session.add(voice)
        db_session.commit()

        retrieved = db_session.query(VoiceProfile).filter_by(id="test_preview_001").first()
        assert retrieved.preview["preview_audio_path"] == "/tmp/preview.wav"

    def test_voice_profile_all_paths_nullable(self, db_session):
        """仅 name 必填，preview 可为 None，voice/voice_params 默认为空 dict"""
        voice = VoiceProfile(id="test_all_null", name="Minimal")
        db_session.add(voice)
        db_session.commit()

        assert voice.preview is None
        assert voice.voice == {}
        assert voice.voice_params == {}

    def test_voice_profile_project_id(self, db_session):
        """project_id 设置项目专属声音"""
        voice = VoiceProfile(
            id="test_proj_voice",
            name="Project Voice",
            project_id="proj-123",
        )
        db_session.add(voice)
        db_session.commit()

        retrieved = db_session.query(VoiceProfile).filter_by(id="test_proj_voice").first()
        assert retrieved.project_id == "proj-123"

    def test_voice_profile_engine_json(self, db_session):
        """引擎元数据存储在 voice/voice_params JSON 字段"""
        voice = VoiceProfile(
            id="test_engine_001",
            name="Engine Voice",
            voice={
                "model": "cosyvoice",
                "voice_type": "clone",
            },
            voice_params={"cosyvoice": {"params": {"instruction": "warm"}}},
        )
        db_session.add(voice)
        db_session.commit()

        retrieved = db_session.query(VoiceProfile).filter_by(id="test_engine_001").first()
        assert retrieved.voice["model"] == "cosyvoice"
        assert retrieved.voice["voice_type"] == "clone"
        assert retrieved.voice_params == {"cosyvoice": {"params": {"instruction": "warm"}}}
