"""
VoiceProfile 模型单元测试
"""
import pytest
from datetime import datetime
from sqlalchemy.exc import IntegrityError

from app.models.voice_profile import VoiceProfile


class TestVoiceProfileModel:
    """VoiceProfile 模型测试类"""

    def test_create_voice_profile(self, db_session):
        """测试创建 VoiceProfile"""
        # 准备测试数据
        voice_data = {
            "id": "test_voice_001",
            "name": "Test Voice",
            "audio_path": "/tmp/test_audio.wav",
            "role": "custom",
        }

        # 创建对象
        voice = VoiceProfile(**voice_data)
        db_session.add(voice)
        db_session.commit()

        # 验证
        assert voice.id == "test_voice_001"
        assert voice.name == "Test Voice"
        assert voice.audio_path == "/tmp/test_audio.wav"
        assert voice.role == "custom"
        assert voice.is_cloned is False
        assert voice.qwen_voice_id is None
        assert voice.cloned_at is None
        assert isinstance(voice.created_at, datetime)

    def test_voice_profile_required_fields(self, db_session):
        """测试必填字段验证"""
        # 测试缺少 name
        with pytest.raises(IntegrityError):
            voice = VoiceProfile(
                id="test_voice_002",
                audio_path="/tmp/test_audio.wav",
            )
            db_session.add(voice)
            db_session.commit()

        db_session.rollback()

        # 测试缺少 audio_path
        with pytest.raises(IntegrityError):
            voice = VoiceProfile(
                id="test_voice_003",
                name="Test Voice",
            )
            db_session.add(voice)
            db_session.commit()

    def test_voice_profile_default_values(self, db_session):
        """测试默认值"""
        voice = VoiceProfile(
            id="test_voice_004",
            name="Test Voice",
            audio_path="/tmp/test_audio.wav",
        )
        db_session.add(voice)
        db_session.commit()

        assert voice.role == "custom"
        assert voice.is_cloned is False
        assert voice.qwen_voice_id is None
        assert voice.cloned_at is None
        assert voice.created_at is not None

    def test_voice_profile_cloned_state(self, db_session):
        """测试克隆状态"""
        voice = VoiceProfile(
            id="test_voice_005",
            name="Test Voice",
            audio_path="/tmp/test_audio.wav",
            is_cloned=True,
            qwen_voice_id="cloned_voice_123",
            cloned_at=datetime.utcnow(),
        )
        db_session.add(voice)
        db_session.commit()

        assert voice.is_cloned is True
        assert voice.qwen_voice_id == "cloned_voice_123"
        assert isinstance(voice.cloned_at, datetime)

    def test_voice_profile_string_representation(self, db_session):
        """测试字符串表示"""
        voice = VoiceProfile(
            id="test_voice_006",
            name="Test Voice",
            audio_path="/tmp/test_audio.wav",
        )
        db_session.add(voice)
        db_session.commit()

        # SQLAlchemy 的默认 __repr__
        assert "VoiceProfile" in repr(voice)
        assert "test_voice_006" in repr(voice)

    def test_voice_profile_update(self, db_session):
        """测试更新 VoiceProfile"""
        # 创建
        voice = VoiceProfile(
            id="test_voice_007",
            name="Original Name",
            audio_path="/tmp/original_audio.wav",
        )
        db_session.add(voice)
        db_session.commit()

        # 更新
        voice.name = "Updated Name"
        voice.audio_path = "/tmp/updated_audio.wav"
        voice.is_cloned = True
        voice.qwen_voice_id = "updated_clone_id"
        voice.cloned_at = datetime.utcnow()
        db_session.commit()

        # 验证更新
        updated_voice = db_session.query(VoiceProfile).filter_by(id="test_voice_007").first()
        assert updated_voice.name == "Updated Name"
        assert updated_voice.audio_path == "/tmp/updated_audio.wav"
        assert updated_voice.is_cloned is True
        assert updated_voice.qwen_voice_id == "updated_clone_id"
        assert updated_voice.cloned_at is not None

    def test_voice_profile_delete(self, db_session):
        """测试删除 VoiceProfile"""
        voice = VoiceProfile(
            id="test_voice_008",
            name="Test Voice",
            audio_path="/tmp/test_audio.wav",
        )
        db_session.add(voice)
        db_session.commit()

        # 验证存在
        assert db_session.query(VoiceProfile).filter_by(id="test_voice_008").first() is not None

        # 删除
        db_session.delete(voice)
        db_session.commit()

        # 验证不存在
        assert db_session.query(VoiceProfile).filter_by(id="test_voice_008").first() is None

    @pytest.mark.parametrize("role", ["male", "female", "custom", "other"])
    def test_voice_profile_role_values(self, db_session, role):
        """测试不同角色值"""
        voice = VoiceProfile(
            id=f"test_voice_{role}",
            name=f"Test Voice {role}",
            audio_path="/tmp/test_audio.wav",
            role=role,
        )
        db_session.add(voice)
        db_session.commit()

        retrieved = db_session.query(VoiceProfile).filter_by(id=f"test_voice_{role}").first()
        assert retrieved.role == role

    def test_voice_profile_created_at_auto_set(self, db_session):
        """测试 created_at 自动设置"""
        import time
        before_create = datetime.utcnow()
        time.sleep(0.01)  # 确保时间不同

        voice = VoiceProfile(
            id="test_voice_009",
            name="Test Voice",
            audio_path="/tmp/test_audio.wav",
        )
        db_session.add(voice)
        db_session.commit()

        time.sleep(0.01)
        after_create = datetime.utcnow()

        assert voice.created_at is not None
        assert before_create < voice.created_at < after_create