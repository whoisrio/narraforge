"""
测试配置和夹具 (fixtures) 文件
"""
import asyncio
import os
import tempfile
from pathlib import Path
from typing import Generator, AsyncGenerator
from unittest.mock import Mock, AsyncMock, patch, MagicMock

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session
from sqlalchemy.pool import StaticPool

from app.core.config import settings
from app.core.database import Base, get_db
from main import app

# 测试环境配置
TEST_DATABASE_URL = "sqlite:///:memory:"

# 临时目录用于测试文件
TEST_VOICES_DIR = tempfile.mkdtemp()
TEST_UPLOADS_DIR = tempfile.mkdtemp()


@pytest.fixture(scope="session", autouse=True)
def setup_test_environment():
    """设置测试环境"""
    # 覆盖配置文件中的目录
    original_voices_dir = settings.voices_dir
    original_database_url = settings.database_url

    # 设置为测试目录
    settings.voices_dir = Path(TEST_VOICES_DIR)
    settings.database_url = TEST_DATABASE_URL

    # 创建临时目录
    os.makedirs(TEST_VOICES_DIR, exist_ok=True)
    os.makedirs(TEST_UPLOADS_DIR, exist_ok=True)

    yield

    # 清理
    import shutil
    shutil.rmtree(TEST_VOICES_DIR, ignore_errors=True)
    shutil.rmtree(TEST_UPLOADS_DIR, ignore_errors=True)

    # 恢复原始设置
    settings.voices_dir = original_voices_dir
    settings.database_url = original_database_url


@pytest.fixture(scope="session")
def event_loop():
    """为异步测试创建事件循环"""
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    yield loop
    loop.close()


@pytest.fixture(scope="session")
def engine():
    """创建测试数据库引擎"""
    engine = create_engine(
        TEST_DATABASE_URL,
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    # 创建所有表
    Base.metadata.create_all(bind=engine)
    yield engine
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def db_session(engine) -> Generator[Session, None, None]:
    """创建数据库会话"""
    connection = engine.connect()
    transaction = connection.begin()
    session = sessionmaker(autocommit=False, autoflush=False, bind=connection)()

    yield session

    session.close()
    transaction.rollback()
    connection.close()


@pytest.fixture
def client(db_session) -> Generator[TestClient, None, None]:
    """创建 FastAPI 测试客户端"""

    def override_get_db():
        try:
            yield db_session
        finally:
            pass

    # 覆盖数据库依赖
    app.dependency_overrides[get_db] = override_get_db

    with TestClient(app) as test_client:
        yield test_client

    # 清理覆盖
    app.dependency_overrides.clear()


@pytest.fixture
def mock_tts_service():
    """模拟 Qwen TTS 服务"""
    with patch("app.services.qwen_tts_service.QwenTTSService") as mock:
        service = Mock()

        # 模拟音频数据（WAV 头部）
        mock_audio_data = b'RIFF\x00\x00\x00WAVEfmt\x00\x00\x00data\x00\x00\x00'

        # 配置模拟方法
        service.synthesize_speech = AsyncMock(return_value=mock_audio_data)
        service.clone_voice = AsyncMock(return_value=mock_audio_data)
        service.register_cloned_voice = AsyncMock(return_value={
            "voice_id": "test_cloned_voice_123",
            "voice_name": "Test Voice",
            "role": "custom"
        })

        mock.return_value = service
        yield service


@pytest.fixture
def mock_openai_api():
    """模拟 OpenAI API 调用（如果将来添加）"""
    with patch("openai.Completion.create") as mock:
        mock.return_value = {
            "choices": [{"text": "Mocked response"}]
        }
        yield mock


@pytest.fixture
def sample_audio_file():
    """创建测试音频文件"""
    import wave
    import struct

    # 创建简单的 WAV 文件
    temp_file = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    temp_file.close()

    # 使用 Python 的 wave 模块创建 WAV 文件
    with wave.open(temp_file.name, 'w') as wav_file:
        wav_file.setparams((1, 2, 44100, 0, 'NONE', 'NONE'))

        # 写入一些样本数据
        samples = []
        for i in range(1000):
            sample = int(32767.0 * 0.5 * (1.0 + 0.5 * (i % 100) / 100.0))
            packed_sample = struct.pack('<h', sample)
            samples.append(packed_sample)

        wav_file.writeframes(b''.join(samples))

    yield temp_file.name

    # 清理
    if os.path.exists(temp_file.name):
        os.unlink(temp_file.name)


@pytest.fixture
def test_voice_data():
    """测试用的声音数据"""
    return {
        "name": "Test Voice",
        "voice_id": "test_voice_001",
        "role": "custom",
        "text": "这是一个测试文本，用于语音合成测试。"
    }


@pytest.fixture
def mock_http_client():
    """模拟 HTTP 客户端"""
    with patch("httpx.AsyncClient") as mock:
        client = AsyncMock()
        response = Mock()
        response.status_code = 200
        response.json.return_value = {
            "code": "Success",
            "output": {
                "task_id": "test_task_123",
                "audio": {
                    "data": "ZmFrZV9hdWRpb19kYXRh"  # base64 编码的 "fake_audio_data"
                }
            }
        }
        client.post = AsyncMock(return_value=response)
        mock.return_value.__aenter__.return_value = client
        yield client


@pytest.fixture(autouse=True)
def cleanup_test_files():
    """每次测试后清理测试文件"""
    yield

    # 清理测试目录中的文件
    for test_dir in [TEST_VOICES_DIR, TEST_UPLOADS_DIR]:
        if os.path.exists(test_dir):
            for file in os.listdir(test_dir):
                try:
                    os.remove(os.path.join(test_dir, file))
                except:
                    pass