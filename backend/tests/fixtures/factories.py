"""
工厂模式创建测试对象
"""
import uuid
from datetime import datetime
from typing import Dict, Any

import factory
from factory.alchemy import SQLAlchemyModelFactory

from app.core.database import SessionLocal
from app.models.voice_profile import VoiceProfile
from app.models.tts_config import TTSConfig
from app.models.timeline import TimelineProject, TimelineSegment


class VoiceProfileFactory(SQLAlchemyModelFactory):
    """VoiceProfile 工厂"""

    class Meta:
        model = VoiceProfile
        sqlalchemy_session = SessionLocal
        sqlalchemy_session_persistence = "commit"

    id = factory.LazyFunction(lambda: str(uuid.uuid4()))
    name = factory.Faker("name")
    audio_path = factory.LazyFunction(
        lambda: f"/tmp/test_audio_{uuid.uuid4().hex}.wav"
    )
    role = "custom"
    is_cloned = False
    qwen_voice_id = None
    cloned_at = None
    created_at = factory.LazyFunction(datetime.utcnow)

    @classmethod
    def create_cloned(cls, **kwargs) -> VoiceProfile:
        """创建已克隆的声音"""
        return cls.create(
            is_cloned=True,
            qwen_voice_id=f"cloned_{uuid.uuid4().hex}",
            cloned_at=datetime.utcnow(),
            **kwargs
        )


class TTSConfigFactory(SQLAlchemyModelFactory):
    """TTSConfig 工厂"""

    class Meta:
        model = TTSConfig
        sqlalchemy_session = SessionLocal
        sqlalchemy_session_persistence = "commit"

    id = factory.LazyFunction(lambda: str(uuid.uuid4()))
    name = factory.Faker("word")
    voice_id = "xiaoyun"
    speed = 1.0
    volume = 80
    pitch = 0
    emotion = "neutral"
    created_at = factory.LazyFunction(datetime.utcnow)


class TimelineProjectFactory(SQLAlchemyModelFactory):
    """TimelineProject 工厂"""

    class Meta:
        model = TimelineProject
        sqlalchemy_session = SessionLocal
        sqlalchemy_session_persistence = "commit"

    id = factory.LazyFunction(lambda: str(uuid.uuid4()))
    name = factory.Faker("sentence", nb_words=3)
    description = factory.Faker("paragraph")
    created_at = factory.LazyFunction(datetime.utcnow)


class TimelineSegmentFactory(SQLAlchemyModelFactory):
    """TimelineSegment 工厂"""

    class Meta:
        model = TimelineSegment
        sqlalchemy_session = SessionLocal
        sqlalchemy_session_persistence = "commit"

    id = factory.LazyFunction(lambda: str(uuid.uuid4()))
    project_id = factory.LazyFunction(lambda: str(uuid.uuid4()))
    text = factory.Faker("sentence")
    start_time = factory.Sequence(lambda n: float(n))
    end_time = factory.Sequence(lambda n: float(n + 1))
    audio_path = factory.LazyFunction(
        lambda: f"/tmp/test_segment_{uuid.uuid4().hex}.wav"
    )
    created_at = factory.LazyFunction(datetime.utcnow)


# 测试数据生成器
def create_test_voice_data(**overrides) -> Dict[str, Any]:
    """创建测试声音数据"""
    data = {
        "name": "Test Voice",
        "voice_id": f"test_{uuid.uuid4().hex[:8]}",
        "role": "custom",
        "text": "这是一个测试文本，用于语音合成测试。",
        "speed": 1.0,
        "volume": 80,
        "pitch": 0,
        "emotion": "neutral",
    }
    data.update(overrides)
    return data


def create_test_tts_request(**overrides) -> Dict[str, Any]:
    """创建 TTS 请求数据"""
    data = {
        "text": "Hello, this is a test for TTS synthesis.",
        "speed": 1.0,
        "volume": 80,
        "pitch": 0,
        "emotion": "neutral",
        "voice_id": "xiaoyun",
    }
    data.update(overrides)
    return data


def create_test_clone_request(**overrides) -> Dict[str, Any]:
    """创建声音克隆请求数据"""
    data = {
        "voice_id": "test_voice_001",
        "name": "Cloned Voice",
        "role": "custom",
    }
    data.update(overrides)
    return data


def create_test_batch_tts_request(**overrides) -> Dict[str, Any]:
    """创建批量 TTS 请求数据"""
    data = {
        "segments": [
            {
                "text": "First segment text.",
                "start_time": 0.0,
                "end_time": 2.0,
            },
            {
                "text": "Second segment text.",
                "start_time": 2.0,
                "end_time": 4.0,
            },
        ],
        "speed": 1.0,
        "volume": 80,
        "pitch": 0,
        "emotion": "neutral",
    }
    data.update(overrides)
    return data