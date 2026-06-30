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
            "source_audio_path": "/tmp/test_audio.wav",
        }

        voice = VoiceProfile(**voice_data)
        db_session.add(voice)
        db_session.commit()

        assert voice.id == "test_voice_001"
        assert voice.name == "Test Voice"
        assert voice.source_audio_path == "/tmp/test_audio.wav"
        assert voice.engine == {}
        assert voice.engine_params is None
        assert isinstance(voice.created_at, datetime)

    def test_voice_profile_required_fields(self, db_session):
        """测试必填字段验证 — name 是唯一必填字段"""
        with pytest.raises(IntegrityError):
            voice = VoiceProfile(
                id="test_voice_002",
                source_audio_path="/tmp/test_audio.wav",
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
        assert voice.source_audio_path is None

    def test_voice_profile_default_values(self, db_session):
        """测试默认值"""
        voice = VoiceProfile(
            id="test_voice_004",
            name="Test Voice",
            source_audio_path="/tmp/test_audio.wav",
        )
        db_session.add(voice)
        db_session.commit()

        assert voice.engine == {}
        assert voice.engine_params is None
        assert voice.created_at is not None

    def test_voice_profile_string_representation(self, db_session):
        """测试字符串表示"""
        voice = VoiceProfile(
            id="test_voice_006",
            name="Test Voice",
            source_audio_path="/tmp/test_audio.wav",
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
            source_audio_path="/tmp/original_audio.wav",
        )
        db_session.add(voice)
        db_session.commit()

        voice.name = "Updated Name"
        voice.source_audio_path = "/tmp/updated_audio.wav"
        voice.engine = {"type": "qwen", "qwen_voice_id": "updated_clone_id", "is_cloned": True}
        db_session.commit()

        updated_voice = db_session.query(VoiceProfile).filter_by(id="test_voice_007").first()
        assert updated_voice.name == "Updated Name"
        assert updated_voice.source_audio_path == "/tmp/updated_audio.wav"
        assert updated_voice.engine["is_cloned"] is True
        assert updated_voice.engine["qwen_voice_id"] == "updated_clone_id"

    def test_voice_profile_delete(self, db_session):
        """测试删除 VoiceProfile"""
        voice = VoiceProfile(
            id="test_voice_008",
            name="Test Voice",
            source_audio_path="/tmp/test_audio.wav",
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
            source_audio_path="/tmp/test_audio.wav",
        )
        db_session.add(voice)
        db_session.commit()

        time.sleep(0.01)
        after_create = utcnow()

        assert voice.created_at is not None
        assert before_create < voice.created_at < after_create

    def test_voice_profile_cloned_preview_path(self, db_session):
        """cloned_preview_path 存储试听音频路径"""
        voice = VoiceProfile(
            id="test_preview_001",
            name="Preview Voice",
            source_audio_path="/tmp/source.wav",
            cloned_preview_path="/tmp/preview.wav",
        )
        db_session.add(voice)
        db_session.commit()

        retrieved = db_session.query(VoiceProfile).filter_by(id="test_preview_001").first()
        assert retrieved.cloned_preview_path == "/tmp/preview.wav"

    def test_voice_profile_all_paths_nullable(self, db_session):
        """仅 name 必填，所有音频路径均可为 NULL"""
        voice = VoiceProfile(id="test_all_null", name="Minimal")
        db_session.add(voice)
        db_session.commit()

        assert voice.source_audio_path is None
        assert voice.cloned_preview_path is None
        assert voice.engine == {}

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
        """引擎元数据存储在 engine JSON 字段"""
        voice = VoiceProfile(
            id="test_engine_001",
            name="Engine Voice",
            engine={
                "type": "clone",
                "engine_type": "CosyVoice",
                "engine_sub_type": None,
            },
            engine_params={"instruction": "warm"},
        )
        db_session.add(voice)
        db_session.commit()

        retrieved = db_session.query(VoiceProfile).filter_by(id="test_engine_001").first()
        assert retrieved.engine["type"] == "clone"
        assert retrieved.engine["engine_type"] == "CosyVoice"
        assert retrieved.engine_params == {"instruction": "warm"}
