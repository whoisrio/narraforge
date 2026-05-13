"""EdgeTTSService 单元测试"""
import pytest
from unittest.mock import AsyncMock, patch, MagicMock

from app.services.edge_tts_service import (
    EdgeTTSService,
    get_edge_tts_service,
    _locale_to_language,
)


# --- _locale_to_language ---

def test_locale_to_language_chinese():
    assert _locale_to_language("zh-CN") == "Chinese"
    assert _locale_to_language("zh-TW") == "Chinese"


def test_locale_to_language_english():
    assert _locale_to_language("en-US") == "English"
    assert _locale_to_language("en-GB") == "English"


def test_locale_to_language_unknown():
    assert _locale_to_language("xx-XX") == "xx"


# --- list_voices ---

@pytest.mark.asyncio
async def test_list_voices_no_filter():
    """无筛选时返回所有音色"""
    service = EdgeTTSService()
    mock_voices = [
        {
            "Name": "Microsoft Server Speech Text to Speech Voice (zh-CN, XiaoxiaoNeural)",
            "ShortName": "zh-CN-XiaoxiaoNeural",
            "Gender": "Female",
            "Locale": "zh-CN",
            "FriendlyName": "Microsoft Xiaoxiao Online (Natural) - Chinese (Mainland)",
            "Status": "GA",
            "VoiceTag": {"ContentCategories": ["General"], "VoicePersonalities": []},
        },
        {
            "Name": "Microsoft Server Speech Text to Speech Voice (en-US, GuyNeural)",
            "ShortName": "en-US-GuyNeural",
            "Gender": "Male",
            "Locale": "en-US",
            "FriendlyName": "Microsoft Guy Online (Natural) - English (United States)",
            "Status": "GA",
            "VoiceTag": {"ContentCategories": ["General"], "VoicePersonalities": []},
        },
    ]

    with patch("app.services.edge_tts_service.edge_tts") as mock_edge_tts:
        mock_edge_tts.list_voices = AsyncMock(return_value=mock_voices)
        service._voices_cache = None  # clear cache

        result = await service.list_voices()

    assert len(result) == 2
    assert result[0]["short_name"] == "zh-CN-XiaoxiaoNeural"
    assert result[0]["display_name"] == "Xiaoxiao"
    assert result[0]["gender"] == "Female"
    assert result[0]["language"] == "Chinese"
    assert result[1]["short_name"] == "en-US-GuyNeural"
    assert result[1]["language"] == "English"


@pytest.mark.asyncio
async def test_list_voices_filter_by_language():
    """按语言筛选音色"""
    service = EdgeTTSService()
    mock_voices = [
        {
            "Name": "Microsoft Server Speech Text to Speech Voice (zh-CN, XiaoxiaoNeural)",
            "ShortName": "zh-CN-XiaoxiaoNeural",
            "Gender": "Female",
            "Locale": "zh-CN",
            "FriendlyName": "Xiaoxiao",
            "Status": "GA",
            "VoiceTag": {"ContentCategories": ["General"], "VoicePersonalities": []},
        },
        {
            "Name": "Microsoft Server Speech Text to Speech Voice (en-US, GuyNeural)",
            "ShortName": "en-US-GuyNeural",
            "Gender": "Male",
            "Locale": "en-US",
            "FriendlyName": "Guy",
            "Status": "GA",
            "VoiceTag": {"ContentCategories": ["General"], "VoicePersonalities": []},
        },
    ]

    with patch("app.services.edge_tts_service.edge_tts") as mock_edge_tts:
        mock_edge_tts.list_voices = AsyncMock(return_value=mock_voices)
        service._voices_cache = None

        result = await service.list_voices(language="Chinese")

    assert len(result) == 1
    assert result[0]["language"] == "Chinese"


@pytest.mark.asyncio
async def test_list_voices_filter_by_gender():
    """按性别筛选音色"""
    service = EdgeTTSService()
    mock_voices = [
        {
            "Name": "Microsoft Server Speech Text to Speech Voice (zh-CN, XiaoxiaoNeural)",
            "ShortName": "zh-CN-XiaoxiaoNeural",
            "Gender": "Female",
            "Locale": "zh-CN",
            "FriendlyName": "Xiaoxiao",
            "Status": "GA",
            "VoiceTag": {"ContentCategories": ["General"], "VoicePersonalities": []},
        },
        {
            "Name": "Microsoft Server Speech Text to Speech Voice (zh-CN, YunxiNeural)",
            "ShortName": "zh-CN-YunxiNeural",
            "Gender": "Male",
            "Locale": "zh-CN",
            "FriendlyName": "Yunxi",
            "Status": "GA",
            "VoiceTag": {"ContentCategories": ["General"], "VoicePersonalities": []},
        },
    ]

    with patch("app.services.edge_tts_service.edge_tts") as mock_edge_tts:
        mock_edge_tts.list_voices = AsyncMock(return_value=mock_voices)
        service._voices_cache = None

        result = await service.list_voices(gender="Male")

    assert len(result) == 1
    assert result[0]["gender"] == "Male"


# --- synthesize ---

@pytest.mark.asyncio
async def test_synthesize_success():
    """合成语音成功"""
    service = EdgeTTSService()
    fake_audio = b"\xff\xfb\x90\x00" * 100  # fake mp3 data

    async def mock_stream():
        yield {"type": "audio", "data": fake_audio}

    mock_communicate = MagicMock()
    mock_communicate.stream = mock_stream

    with patch("app.services.edge_tts_service.edge_tts") as mock_edge_tts:
        mock_edge_tts.Communicate = MagicMock(return_value=mock_communicate)

        audio_data, audio_format = await service.synthesize(
            text="Hello",
            voice="en-US-GuyNeural",
            rate="+0%",
            volume="+0%",
        )

    assert audio_data == fake_audio
    assert audio_format == "mp3"


@pytest.mark.asyncio
async def test_synthesize_no_audio_raises():
    """合成语音无音频数据时抛出异常"""
    service = EdgeTTSService()

    async def empty_stream():
        return
        yield  # make it an async generator

    mock_communicate = MagicMock()
    mock_communicate.stream = empty_stream

    with patch("app.services.edge_tts_service.edge_tts") as mock_edge_tts:
        mock_edge_tts.Communicate = MagicMock(return_value=mock_communicate)

        with pytest.raises(RuntimeError, match="No audio received"):
            await service.synthesize(
                text="Hello",
                voice="en-US-GuyNeural",
            )


# --- get_edge_tts_service ---

def test_get_edge_tts_service_singleton():
    """测试服务单例"""
    import app.services.edge_tts_service as mod
    mod._edge_tts_service = None

    s1 = get_edge_tts_service()
    s2 = get_edge_tts_service()
    assert s1 is s2

    mod._edge_tts_service = None  # cleanup
