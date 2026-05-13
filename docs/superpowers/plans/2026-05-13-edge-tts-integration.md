# Edge-TTS Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add edge-tts as a parallel TTS engine so users can switch between CosyVoice and Edge-TTS on the TTS page.

**Architecture:** New `EdgeTTSService` in backend alongside existing `QwenTTSService`. TTS API endpoint gains `engine` field to route between services. Frontend adds engine selector tab and Edge-TTS panel with voice filtering.

**Tech Stack:** Python edge-tts library, FastAPI, React + TypeScript

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `backend/app/services/edge_tts_service.py` | EdgeTTS service: list voices, synthesize |
| Modify | `backend/app/api/tts.py` | Add engine routing to synthesize, add edge-voices endpoint |
| Modify | `backend/requirements.txt` | Add edge-tts dependency |
| Create | `backend/tests/unit/test_edge_tts_service.py` | Unit tests for EdgeTTSService |
| Modify | `backend/tests/conftest.py` | Add mock_edge_tts_service fixture |
| Modify | `backend/tests/test_api_tts.py` | Add API tests for edge-tts endpoints |
| Modify | `frontend/src/types/index.ts` | Add EdgeVoice type, extend TTSRequest |
| Modify | `frontend/src/services/api.ts` | Add getEdgeVoices API method |
| Create | `frontend/src/components/TTSSynthesis/EdgeTTSPanel.tsx` | Edge-TTS panel: filter + voice list + params |
| Create | `frontend/src/components/TTSSynthesis/EdgeTTSPanel.module.css` | Styles for Edge-TTS panel |
| Modify | `frontend/src/pages/TTSSynthesis.tsx` | Add engine selector, conditional panel rendering |
| Modify | `frontend/src/pages/TTSSynthesis.module.css` | Add engine selector styles |

---

### Task 1: Add edge-tts dependency

**Files:**
- Modify: `backend/requirements.txt`

- [ ] **Step 1: Add edge-tts to requirements.txt**

Append `edge-tts>=7.0.0` to `backend/requirements.txt`:

```
edge-tts>=7.0.0
```

- [ ] **Step 2: Install the dependency**

Run: `cd /Users/rio/repos/myprjs/voiceclone/backend && uv pip install edge-tts`

- [ ] **Step 3: Verify installation**

Run: `python -c "import edge_tts; print('edge-tts installed')"`
Expected: `edge-tts installed`

- [ ] **Step 4: Commit**

```bash
git add backend/requirements.txt
git commit -m "chore: add edge-tts dependency"
```

---

### Task 2: Create EdgeTTSService

**Files:**
- Create: `backend/app/services/edge_tts_service.py`

- [ ] **Step 1: Create the service file**

```python
"""Edge-TTS 语音合成服务
使用 Microsoft Edge 在线 TTS 服务，支持多种语言和音色
"""

import asyncio
import uuid
import time
import logging
from typing import Optional

import edge_tts

from app.core.config import settings

logger = logging.getLogger(__name__)

# locale 前缀到语言显示名的映射
LOCALE_LANGUAGE_MAP = {
    "zh-CN": "Chinese",
    "zh-TW": "Chinese",
    "zh-HK": "Chinese",
    "en-US": "English",
    "en-GB": "English",
    "en-AU": "English",
    "en-CA": "English",
    "en-IN": "English",
    "ja-JP": "Japanese",
    "ko-KR": "Korean",
    "fr-FR": "French",
    "de-DE": "German",
    "es-ES": "Spanish",
    "pt-BR": "Portuguese",
    "ru-RU": "Russian",
    "it-IT": "Italian",
    "nl-NL": "Dutch",
    "pl-PL": "Polish",
    "tr-TR": "Turkish",
    "ar-SA": "Arabic",
    "th-TH": "Thai",
    "vi-VN": "Vietnamese",
    "id-ID": "Indonesian",
}


def _locale_to_language(locale: str) -> str:
    """将 locale (如 zh-CN) 转为语言显示名 (如 Chinese)"""
    return LOCALE_LANGUAGE_MAP.get(locale, locale.split("-")[0])


class EdgeTTSService:
    """Edge-TTS 服务 - 支持多种语言和音色"""

    _voices_cache: Optional[list[dict]] = None
    _voices_cache_time: float = 0
    _cache_ttl: float = 3600  # 1 hour

    async def list_voices(
        self,
        language: Optional[str] = None,
        gender: Optional[str] = None,
    ) -> list[dict]:
        """获取 edge-tts 支持的音色列表，支持按语言和性别筛选

        Args:
            language: 语言名 (如 "Chinese", "English")
            gender: 性别 ("Male" 或 "Female")

        Returns:
            音色列表，每个音色包含 name, short_name, gender, locale, language
        """
        voices = await self._get_all_voices()

        if language:
            voices = [v for v in voices if v["language"] == language]
        if gender:
            voices = [v for v in voices if v["gender"] == gender]

        return voices

    async def _get_all_voices(self) -> list[dict]:
        """获取所有音色，使用内存缓存"""
        now = time.time()
        if self._voices_cache is not None and (now - self._voices_cache_time) < self._cache_ttl:
            return self._voices_cache

        raw_voices = await edge_tts.list_voices()

        voices = []
        for v in raw_voices:
            short_name = v["ShortName"]
            locale = v["Locale"]
            gender = v["Gender"]

            # 从 ShortName 提取显示名（去掉语言前缀和 Neural 后缀）
            # e.g. "zh-CN-XiaoxiaoNeural" -> "Xiaoxiao"
            parts = short_name.split("-")
            display_name = parts[-1].replace("Neural", "").replace("V2", "").replace("V3", "")

            voices.append({
                "name": v["Name"],
                "short_name": short_name,
                "display_name": display_name,
                "gender": gender,
                "locale": locale,
                "language": _locale_to_language(locale),
            })

        self._voices_cache = voices
        self._voices_cache_time = now
        return voices

    async def get_available_languages(self) -> list[str]:
        """获取所有可用语言列表"""
        voices = await self._get_all_voices()
        languages = sorted(set(v["language"] for v in voices))
        return languages

    async def synthesize(
        self,
        text: str,
        voice: str,
        rate: str = "+0%",
        volume: str = "+0%",
    ) -> tuple[bytes, str]:
        """使用 edge-tts 合成语音

        Args:
            text: 要合成的文本
            voice: 音色名 (如 "zh-CN-XiaoxiaoNeural")
            rate: 语速 (如 "+0%", "+50%", "-20%")
            volume: 音量 (如 "+0%", "+10%", "-10%")

        Returns:
            (audio_data, audio_format) 音频数据和格式
        """
        communicate = edge_tts.Communicate(
            text=text,
            voice=voice,
            rate=rate,
            volume=volume,
            connect_timeout=10,
            receive_timeout=30,
        )

        audio_data = b""
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                audio_data += chunk["data"]

        if not audio_data:
            raise RuntimeError("No audio received from edge-tts")

        return audio_data, "mp3"


# 全局服务实例
_edge_tts_service: Optional[EdgeTTSService] = None


def get_edge_tts_service() -> EdgeTTSService:
    """获取 Edge TTS 服务实例"""
    global _edge_tts_service
    if _edge_tts_service is None:
        _edge_tts_service = EdgeTTSService()
    return _edge_tts_service
```

- [ ] **Step 2: Verify the service can be imported**

Run: `cd /Users/rio/repos/myprjs/voiceclone/backend && python -c "from app.services.edge_tts_service import get_edge_tts_service; print('OK')"`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add backend/app/services/edge_tts_service.py
git commit -m "feat: add EdgeTTSService with voice listing and synthesis"
```

---

### Task 3: Write unit tests for EdgeTTSService

**Files:**
- Create: `backend/tests/unit/test_edge_tts_service.py`

- [ ] **Step 1: Write the test file**

```python
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

    mock_communicate = MagicMock()
    mock_communicate.stream = AsyncMock(return_value=[
        {"type": "audio", "data": fake_audio},
    ])

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

    mock_communicate = MagicMock()
    mock_communicate.stream = AsyncMock(return_value=[])
    # Need to make it an async iterable
    mock_communicate.stream = AsyncMock(return_value=[])
    async def empty_stream():
        return
        yield  # make it an async generator

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
```

- [ ] **Step 2: Run the tests**

Run: `cd /Users/rio/repos/myprjs/voiceclone/backend && python -m pytest tests/unit/test_edge_tts_service.py -v`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add backend/tests/unit/test_edge_tts_service.py
git commit -m "test: add EdgeTTSService unit tests"
```

---

### Task 4: Modify TTS API to support engine routing

**Files:**
- Modify: `backend/app/api/tts.py`

- [ ] **Step 1: Update TTSRequest model and add engine routing to synthesize endpoint**

In `backend/app/api/tts.py`, replace the `TTSRequest` class (lines 23-31) with:

```python
class TTSRequest(BaseModel):
    text: str
    engine: str = "cosyvoice"  # "cosyvoice" | "edge_tts"
    # CosyVoice params
    voice_id: str = ""
    speed: float = 1.0
    volume: float = 80
    pitch: int = 0
    emotion: str = "neutral"
    language: str = "Chinese"
    format: str = "wav"
    # Edge-TTS params
    edge_voice: str = ""
    edge_rate: str = "+0%"
    edge_volume: str = "+0%"
```

- [ ] **Step 2: Update the synthesize endpoint to route by engine**

Replace the `synthesize_speech` function (lines 66-133) with:

```python
@router.post("/synthesize")
async def synthesize_speech(request: TTSRequest, db: Session = Depends(get_db)):
    """合成语音 - 支持多引擎"""
    if request.engine == "edge_tts":
        return await _synthesize_edge_tts(request, db)
    else:
        return await _synthesize_cosyvoice(request, db)


async def _synthesize_cosyvoice(request: TTSRequest, db: Session = Depends(get_db)):
    """CosyVoice 引擎合成"""
    audio_fmt = request.format or "wav"
    audio_id = str(uuid.uuid4())
    audio_path = settings.voices_dir / f"tts_{audio_id}.{audio_fmt}"

    if not request.voice_id:
        raise HTTPException(status_code=400, detail="voice_id is required")

    try:
        tts_service = await get_tts_service()

        logger.info(f"Synthesizing with cloned voice: {request.voice_id}")
        audio_data = await tts_service.clone_voice(
            voice_id=request.voice_id,
            text=request.text,
            speed=request.speed,
            volume=request.volume,
            pitch=request.pitch,
            format=audio_fmt,
            sample_rate=16000,
        )

        async with aiofiles.open(audio_path, "wb") as f:
            await f.write(audio_data)

        voice = (
            db.query(VoiceProfile)
            .filter(VoiceProfile.qwen_voice_id == request.voice_id)
            .first()
        )
        voice_name = voice.name if voice else request.voice_id

        record = TTSResultRecord(
            id=audio_id,
            text=request.text,
            voice_id=request.voice_id,
            voice_name=voice_name,
            audio_path=str(audio_path),
            audio_format=audio_fmt,
            speed=request.speed,
            volume=request.volume,
            pitch=request.pitch,
            emotion=request.emotion,
            language=request.language,
        )
        db.add(record)
        db.commit()

        return {
            "audio_id": audio_id,
            "audio_url": f"/api/tts/audio/{audio_id}",
            "text": request.text,
            "params": {
                "speed": request.speed,
                "volume": request.volume,
                "pitch": request.pitch,
                "emotion": request.emotion,
                "voice_id": request.voice_id,
            }
        }

    except Exception as e:
        logger.error(f"TTS synthesis failed: {str(e)}")
        raise HTTPException(status_code=500, detail=f"TTS synthesis failed: {str(e)}")


async def _synthesize_edge_tts(request: TTSRequest, db: Session = Depends(get_db)):
    """Edge-TTS 引擎合成"""
    if not request.edge_voice:
        raise HTTPException(status_code=400, detail="edge_voice is required for edge_tts engine")

    audio_id = str(uuid.uuid4())
    audio_path = settings.voices_dir / f"tts_{audio_id}.mp3"

    try:
        from app.services.edge_tts_service import get_edge_tts_service
        edge_service = get_edge_tts_service()

        logger.info(f"Synthesizing with edge-tts: voice={request.edge_voice}, text={request.text[:50]}...")
        audio_data, audio_format = await edge_service.synthesize(
            text=request.text,
            voice=request.edge_voice,
            rate=request.edge_rate,
            volume=request.edge_volume,
        )

        async with aiofiles.open(audio_path, "wb") as f:
            await f.write(audio_data)

        record = TTSResultRecord(
            id=audio_id,
            text=request.text,
            voice_id=request.edge_voice,
            voice_name=request.edge_voice,
            audio_path=str(audio_path),
            audio_format="mp3",
            speed=1.0,
            volume=80,
            pitch=0,
            emotion="neutral",
            language="Chinese",
        )
        db.add(record)
        db.commit()

        return {
            "audio_id": audio_id,
            "audio_url": f"/api/tts/audio/{audio_id}",
            "text": request.text,
            "params": {
                "engine": "edge_tts",
                "edge_voice": request.edge_voice,
                "edge_rate": request.edge_rate,
                "edge_volume": request.edge_volume,
            }
        }

    except Exception as e:
        logger.error(f"Edge-TTS synthesis failed: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Edge-TTS synthesis failed: {str(e)}")
```

- [ ] **Step 3: Add the edge-voices endpoint**

Add after the `list_available_voices` endpoint (after line 235):

```python
@router.get("/edge-voices")
async def list_edge_voices(language: Optional[str] = None, gender: Optional[str] = None):
    """获取 Edge-TTS 可用音色列表"""
    try:
        from app.services.edge_tts_service import get_edge_tts_service
        edge_service = get_edge_tts_service()
        voices = await edge_service.list_voices(language=language, gender=gender)
        return {"voices": voices}
    except Exception as e:
        logger.error(f"Failed to list edge-tts voices: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to list edge-tts voices: {str(e)}")


@router.get("/edge-languages")
async def list_edge_languages():
    """获取 Edge-TTS 可用语言列表"""
    try:
        from app.services.edge_tts_service import get_edge_tts_service
        edge_service = get_edge_tts_service()
        languages = await edge_service.get_available_languages()
        return {"languages": languages}
    except Exception as e:
        logger.error(f"Failed to list edge-tts languages: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to list edge-tts languages: {str(e)}")
```

Also add `Optional` to the existing import on line 5 (it's already there).

- [ ] **Step 4: Run existing TTS tests to verify no regressions**

Run: `cd /Users/rio/repos/myprjs/voiceclone/backend && python -m pytest tests/test_api_tts.py -v`
Expected: PASS (existing tests should still work since `engine` defaults to `"cosyvoice"`)

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/tts.py
git commit -m "feat: add engine routing and edge-voices/edge-languages endpoints to TTS API"
```

---

### Task 5: Add API tests for edge-tts endpoints

**Files:**
- Modify: `backend/tests/conftest.py`
- Modify: `backend/tests/test_api_tts.py`

- [ ] **Step 1: Add mock_edge_tts_service fixture to conftest.py**

Append to `backend/tests/conftest.py` before the `cleanup_test_files` fixture:

```python
@pytest.fixture
def mock_edge_tts_service():
    """模拟 Edge TTS 服务"""
    from app.services import edge_tts_service as edge_module
    edge_module._edge_tts_service = None

    service = Mock()
    fake_audio = b'\xff\xfb\x90\x00' * 50

    service.synthesize = AsyncMock(return_value=(fake_audio, "mp3"))
    service.list_voices = AsyncMock(return_value=[
        {
            "name": "Microsoft Server Speech Text to Speech Voice (zh-CN, XiaoxiaoNeural)",
            "short_name": "zh-CN-XiaoxiaoNeural",
            "display_name": "Xiaoxiao",
            "gender": "Female",
            "locale": "zh-CN",
            "language": "Chinese",
        },
        {
            "name": "Microsoft Server Speech Text to Speech Voice (en-US, GuyNeural)",
            "short_name": "en-US-GuyNeural",
            "display_name": "Guy",
            "gender": "Male",
            "locale": "en-US",
            "language": "English",
        },
    ])
    service.get_available_languages = AsyncMock(return_value=["Chinese", "English"])

    with patch("app.api.tts.get_edge_tts_service", return_value=service):
        yield service

    edge_module._edge_tts_service = None
```

Also add `from unittest.mock import Mock, AsyncMock, patch` import if not already at the top (it is, from line 9).

- [ ] **Step 2: Add edge-tts API tests to test_api_tts.py**

Append to `backend/tests/test_api_tts.py`:

```python
def test_list_edge_voices(client, mock_edge_tts_service):
    """测试获取 Edge-TTS 音色列表"""
    response = client.get("/api/tts/edge-voices")
    assert response.status_code == 200
    data = response.json()
    assert "voices" in data
    assert len(data["voices"]) == 2
    assert data["voices"][0]["short_name"] == "zh-CN-XiaoxiaoNeural"


def test_list_edge_voices_with_filter(client, mock_edge_tts_service):
    """测试按语言筛选 Edge-TTS 音色"""
    response = client.get("/api/tts/edge-voices?language=Chinese")
    assert response.status_code == 200
    mock_edge_tts_service.list_voices.assert_called_with(language="Chinese", gender=None)


def test_list_edge_languages(client, mock_edge_tts_service):
    """测试获取 Edge-TTS 语言列表"""
    response = client.get("/api/tts/edge-languages")
    assert response.status_code == 200
    data = response.json()
    assert "languages" in data
    assert "Chinese" in data["languages"]


def test_synthesize_with_edge_tts(client, mock_edge_tts_service, db_session):
    """测试使用 Edge-TTS 引擎合成语音"""
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
    """测试 Edge-TTS 缺少 voice 参数时返回 400"""
    response = client.post("/api/tts/synthesize", json={
        "text": "Hello world",
        "engine": "edge_tts",
    })
    assert response.status_code == 400
```

- [ ] **Step 3: Run all TTS tests**

Run: `cd /Users/rio/repos/myprjs/voiceclone/backend && python -m pytest tests/test_api_tts.py -v`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add backend/tests/conftest.py backend/tests/test_api_tts.py
git commit -m "test: add API tests for edge-tts endpoints"
```

---

### Task 6: Add EdgeVoice type and extend TTSRequest in frontend

**Files:**
- Modify: `frontend/src/types/index.ts`

- [ ] **Step 1: Add EdgeVoice type and extend TTSRequest**

In `frontend/src/types/index.ts`, add after the `TTSResultRecord` interface (after line 62):

```typescript
// Edge-TTS Voice
export interface EdgeVoice {
  name: string;
  short_name: string;
  display_name: string;
  gender: string;
  locale: string;
  language: string;
}
```

Update the `TTSRequest` interface (lines 14-23) to:

```typescript
// TTS Request params
export interface TTSRequest {
  text: string;
  engine?: 'cosyvoice' | 'edge_tts';
  voice_id: string;
  language?: 'Chinese' | 'English' | 'Japanese' | 'Korean';
  speed?: number; // 0.5 - 2.0
  volume?: number; // 0 - 100
  pitch?: number; // -12 to 12
  emotion?: 'neutral' | 'happy' | 'sad' | 'nervous' | 'excited';
  format?: 'mp3' | 'wav';
  // Edge-TTS params
  edge_voice?: string;
  edge_rate?: string;
  edge_volume?: string;
}
```

- [ ] **Step 2: Verify TypeScript compilation**

Run: `cd /Users/rio/repos/myprjs/voiceclone/frontend && npx tsc --noEmit 2>&1 | head -20`
Expected: No type errors related to the new types (there may be pre-existing errors)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/types/index.ts
git commit -m "feat: add EdgeVoice type and extend TTSRequest for edge-tts"
```

---

### Task 7: Add getEdgeVoices to API client

**Files:**
- Modify: `frontend/src/services/api.ts`

- [ ] **Step 1: Add edge-tts API methods**

In `frontend/src/services/api.ts`, add the import for `EdgeVoice`:

Change line 2 from:
```typescript
import type { VoiceProfile, TTSConfig, TTSRequest, TTSResult, TTSResultRecord } from '../types';
```
to:
```typescript
import type { VoiceProfile, TTSConfig, TTSRequest, TTSResult, TTSResultRecord, EdgeVoice } from '../types';
```

Add to the `ttsApi` object (after `deleteResult`, around line 78):

```typescript
  getEdgeVoices: async (language?: string, gender?: string): Promise<EdgeVoice[]> => {
    const params = new URLSearchParams();
    if (language) params.set('language', language);
    if (gender) params.set('gender', gender);
    const qs = params.toString() ? `?${params.toString()}` : '';
    const { data } = await api.get<{ voices: EdgeVoice[] }>(`/tts/edge-voices${qs}`);
    return data.voices;
  },

  getEdgeLanguages: async (): Promise<string[]> => {
    const { data } = await api.get<{ languages: string[] }>('/tts/edge-languages');
    return data.languages;
  },
```

- [ ] **Step 2: Verify TypeScript compilation**

Run: `cd /Users/rio/repos/myprjs/voiceclone/frontend && npx tsc --noEmit 2>&1 | head -20`
Expected: No type errors related to the new API methods

- [ ] **Step 3: Commit**

```bash
git add frontend/src/services/api.ts
git commit -m "feat: add getEdgeVoices and getEdgeLanguages API methods"
```

---

### Task 8: Create EdgeTTSPanel component

**Files:**
- Create: `frontend/src/components/TTSSynthesis/EdgeTTSPanel.tsx`
- Create: `frontend/src/components/TTSSynthesis/EdgeTTSPanel.module.css`

- [ ] **Step 1: Create the CSS file**

```css
.container {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.section {
  background: white;
  border-radius: 1rem;
  padding: 1.5rem;
}

.section h3 {
  margin-bottom: 1rem;
  font-size: 1.125rem;
}

.filters {
  display: flex;
  gap: 1rem;
  margin-bottom: 1rem;
}

.filter {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  flex: 1;
}

.filter label {
  font-size: 0.875rem;
  color: #666;
  font-weight: 500;
}

.filter select {
  padding: 0.5rem;
  border: 1px solid #ddd;
  border-radius: 0.25rem;
  background: white;
  font-size: 0.875rem;
}

.voiceGrid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 0.5rem;
  max-height: 240px;
  overflow-y: auto;
}

.voiceCard {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
  padding: 0.75rem 0.5rem;
  border: 1px solid #e5e5e5;
  border-radius: 0.5rem;
  background: white;
  cursor: pointer;
  transition: all 0.15s;
  text-align: center;
}

.voiceCard:hover {
  border-color: #3b82f6;
}

.voiceCard.active {
  border-color: #3b82f6;
  background: #eff6ff;
}

.voiceName {
  font-size: 0.875rem;
  font-weight: 500;
}

.voiceLocale {
  font-size: 0.75rem;
  color: #666;
}

.voiceGender {
  font-size: 0.75rem;
  color: #666;
  background: #f5f5f5;
  padding: 0.125rem 0.375rem;
  border-radius: 0.25rem;
}

.params {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
}

.param {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.param label {
  font-size: 0.875rem;
  color: #666;
  font-weight: 500;
}

.param input[type="range"] {
  width: 100%;
  cursor: pointer;
}

.loading,
.error,
.empty {
  text-align: center;
  padding: 1.5rem;
  color: #666;
}

.error {
  color: #ef4444;
}
```

- [ ] **Step 2: Create the component file**

```tsx
import { useState, useEffect, useCallback } from 'react';
import { ttsApi } from '../../services/api';
import type { EdgeVoice } from '../../types';
import styles from './EdgeTTSPanel.module.css';

interface EdgeTTSPanelProps {
  onVoiceSelect: (voice: string) => void;
  onParamsChange: (params: { edge_rate: string; edge_volume: string }) => void;
  selectedVoice: string;
}

const GENDER_OPTIONS = [
  { value: '', label: '全部' },
  { value: 'Female', label: '女声' },
  { value: 'Male', label: '男声' },
] as const;

export function EdgeTTSPanel({ onVoiceSelect, onParamsChange, selectedVoice }: EdgeTTSPanelProps) {
  const [languages, setLanguages] = useState<string[]>([]);
  const [selectedLanguage, setSelectedLanguage] = useState('Chinese');
  const [selectedGender, setSelectedGender] = useState('');
  const [voices, setVoices] = useState<EdgeVoice[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const [rate, setRate] = useState(0);
  const [volume, setVolume] = useState(0);

  // Load available languages on mount
  useEffect(() => {
    const loadLanguages = async () => {
      try {
        const langs = await ttsApi.getEdgeLanguages();
        setLanguages(langs);
      } catch (err) {
        console.error('Failed to load edge-tts languages:', err);
      }
    };
    loadLanguages();
  }, []);

  // Load voices when filters change
  const loadVoices = useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      const data = await ttsApi.getEdgeVoices(
        selectedLanguage || undefined,
        selectedGender || undefined,
      );
      setVoices(data);
      // Auto-select first voice if current selection not in list
      if (data.length > 0 && !data.some(v => v.short_name === selectedVoice)) {
        onVoiceSelect(data[0].short_name);
      }
    } catch (err) {
      setError('加载音色列表失败');
      console.error('Failed to load edge voices:', err);
    } finally {
      setIsLoading(false);
    }
  }, [selectedLanguage, selectedGender, selectedVoice, onVoiceSelect]);

  useEffect(() => {
    loadVoices();
  }, [loadVoices]);

  // Rate/volume to edge-tts format (e.g. -50 -> "-50%", +30 -> "+30%")
  const toEdgeFormat = (value: number) => value >= 0 ? `+${value}%` : `${value}%`;

  const handleRateChange = (newRate: number) => {
    setRate(newRate);
    onParamsChange({ edge_rate: toEdgeFormat(newRate), edge_volume: toEdgeFormat(volume) });
  };

  const handleVolumeChange = (newVolume: number) => {
    setVolume(newVolume);
    onParamsChange({ edge_rate: toEdgeFormat(rate), edge_volume: toEdgeFormat(newVolume) });
  };

  return (
    <div className={styles.container}>
      {/* Voice Selection */}
      <div className={styles.section}>
        <h3>选择音色</h3>

        <div className={styles.filters}>
          <div className={styles.filter}>
            <label>语言</label>
            <select
              value={selectedLanguage}
              onChange={(e) => setSelectedLanguage(e.target.value)}
            >
              {languages.map(lang => (
                <option key={lang} value={lang}>{lang}</option>
              ))}
            </select>
          </div>

          <div className={styles.filter}>
            <label>性别</label>
            <select
              value={selectedGender}
              onChange={(e) => setSelectedGender(e.target.value)}
            >
              {GENDER_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        </div>

        {isLoading ? (
          <div className={styles.loading}>加载音色列表...</div>
        ) : error ? (
          <div className={styles.error}>{error}</div>
        ) : voices.length === 0 ? (
          <div className={styles.empty}>未找到音色</div>
        ) : (
          <div className={styles.voiceGrid}>
            {voices.map(voice => (
              <button
                key={voice.short_name}
                className={`${styles.voiceCard} ${selectedVoice === voice.short_name ? styles.active : ''}`}
                onClick={() => onVoiceSelect(voice.short_name)}
              >
                <span className={styles.voiceName}>{voice.display_name}</span>
                <span className={styles.voiceLocale}>{voice.locale}</span>
                <span className={styles.voiceGender}>{voice.gender === 'Female' ? '女' : '男'}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Parameters */}
      <div className={styles.section}>
        <h3>参数设置</h3>
        <div className={styles.params}>
          <div className={styles.param}>
            <label>语速: {toEdgeFormat(rate)}</label>
            <input
              type="range"
              min={-50}
              max={100}
              step={5}
              value={rate}
              onChange={(e) => handleRateChange(parseInt(e.target.value))}
            />
          </div>
          <div className={styles.param}>
            <label>音量: {toEdgeFormat(volume)}</label>
            <input
              type="range"
              min={-50}
              max={100}
              step={5}
              value={volume}
              onChange={(e) => handleVolumeChange(parseInt(e.target.value))}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify TypeScript compilation**

Run: `cd /Users/rio/repos/myprjs/voiceclone/frontend && npx tsc --noEmit 2>&1 | head -20`
Expected: No type errors related to EdgeTTSPanel

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/TTSSynthesis/EdgeTTSPanel.tsx frontend/src/components/TTSSynthesis/EdgeTTSPanel.module.css
git commit -m "feat: add EdgeTTSPanel component with voice filter and params"
```

---

### Task 9: Integrate engine selector into TTSSynthesis page

**Files:**
- Modify: `frontend/src/pages/TTSSynthesis.tsx`
- Modify: `frontend/src/pages/TTSSynthesis.module.css`

- [ ] **Step 1: Add engine selector styles to TTSSynthesis.module.css**

Append to `frontend/src/pages/TTSSynthesis.module.css`:

```css
.engineTabs {
  display: flex;
  gap: 0;
  background: #f5f5f5;
  border-radius: 0.5rem;
  padding: 0.25rem;
  margin-bottom: 1.5rem;
}

.engineTab {
  flex: 1;
  padding: 0.75rem 1.5rem;
  border: none;
  border-radius: 0.375rem;
  background: transparent;
  font-size: 0.9375rem;
  font-weight: 500;
  color: #666;
  cursor: pointer;
  transition: all 0.2s;
}

.engineTab:hover {
  color: #333;
}

.engineTab.active {
  background: white;
  color: #1890ff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}
```

- [ ] **Step 2: Update TTSSynthesis.tsx to add engine selector and conditional panels**

Replace the entire content of `frontend/src/pages/TTSSynthesis.tsx` with:

```tsx
import { useState, useCallback, useEffect } from 'react';
import { VoiceSelector } from '../components/TTSSynthesis/VoiceSelector';
import { ParameterControls } from '../components/TTSSynthesis/ParameterControls';
import { AudioPlayer } from '../components/TTSSynthesis/AudioPlayer';
import { SynthesisHistory } from '../components/TTSSynthesis/SynthesisHistory';
import { EdgeTTSPanel } from '../components/TTSSynthesis/EdgeTTSPanel';
import { ttsApi, voiceApi } from '../services/api';
import type { TTSRequest, TTSResult, TTSResultRecord } from '../types';
import styles from './TTSSynthesis.module.css';

type Engine = 'cosyvoice' | 'edge_tts';

export function TTSSynthesis() {
  const [engine, setEngine] = useState<Engine>('cosyvoice');
  const [text, setText] = useState('');
  const [selectedVoiceId, setSelectedVoiceId] = useState<string>('');
  const [params, setParams] = useState<Partial<TTSRequest>>({
    language: 'Chinese',
    speed: 1.0,
    volume: 80,
    pitch: 0,
    emotion: undefined,
  });

  // Edge-TTS state
  const [edgeVoice, setEdgeVoice] = useState('');
  const [edgeParams, setEdgeParams] = useState({ edge_rate: '+0%', edge_volume: '+0%' });

  const [result, setResult] = useState<TTSResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [history, setHistory] = useState<TTSResultRecord[]>([]);

  const loadHistory = useCallback(async () => {
    try {
      const data = await ttsApi.getHistory();
      setHistory(data);
    } catch (error) {
      console.error('Failed to load history:', error);
    }
  }, []);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  const handleSynthesize = useCallback(async () => {
    if (!text.trim()) {
      alert('请输入要合成的文本');
      return;
    }

    if (engine === 'cosyvoice' && !selectedVoiceId) {
      alert('请选择一个声音');
      return;
    }

    if (engine === 'edge_tts' && !edgeVoice) {
      alert('请选择一个音色');
      return;
    }

    try {
      setIsLoading(true);
      setResult(null);

      if (engine === 'edge_tts') {
        const response = await ttsApi.synthesize({
          text,
          engine: 'edge_tts',
          voice_id: '',
          edge_voice: edgeVoice,
          edge_rate: edgeParams.edge_rate,
          edge_volume: edgeParams.edge_volume,
          format: 'mp3',
        });
        setResult(response);
      } else {
        const response = await ttsApi.synthesize({
          text,
          voice_id: selectedVoiceId,
          language: params.language || 'Chinese',
          speed: params.speed ?? 1.0,
          volume: params.volume ?? 80,
          pitch: params.pitch ?? 0,
          emotion: params.emotion,
          format: 'mp3',
        });
        setResult(response);
      }

      loadHistory();
    } catch (error) {
      console.error('TTS synthesis failed:', error);
      alert('生成语音失败，请重试');
    } finally {
      setIsLoading(false);
    }
  }, [text, engine, selectedVoiceId, edgeVoice, edgeParams, params, loadHistory]);

  const handleDeleteResult = useCallback(async (id: string) => {
    try {
      await ttsApi.deleteResult(id);
      setHistory(prev => prev.filter(r => r.id !== id));
    } catch (error) {
      console.error('Failed to delete result:', error);
      alert('删除失败');
    }
  }, []);

  const handlePlayResult = useCallback((record: TTSResultRecord) => {
    setResult({
      audio_id: record.id,
      audio_url: record.audio_url,
      text: record.text,
      params: {
        voice_id: record.voice_id,
        speed: record.speed,
        volume: record.volume,
        pitch: record.pitch,
        language: record.language,
        emotion: record.emotion,
      },
    });
  }, []);

  const handleDeleteVoice = useCallback(async (profileId: string) => {
    try {
      await voiceApi.delete(profileId);
      setSelectedVoiceId('');
    } catch (error) {
      console.error('Failed to delete voice:', error);
      alert('删除声音失败');
    }
  }, []);

  const canSynthesize = engine === 'edge_tts'
    ? text.trim() && edgeVoice
    : text.trim() && selectedVoiceId;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1>文字转语音</h1>
        <p>使用克隆的声音生成语音</p>
      </div>

      {/* Engine Selector */}
      <div className={styles.engineTabs}>
        <button
          className={`${styles.engineTab} ${engine === 'cosyvoice' ? styles.active : ''}`}
          onClick={() => setEngine('cosyvoice')}
        >
          CosyVoice
        </button>
        <button
          className={`${styles.engineTab} ${engine === 'edge_tts' ? styles.active : ''}`}
          onClick={() => setEngine('edge_tts')}
        >
          Edge-TTS
        </button>
      </div>

      <div className={styles.content}>
        {/* Left Column: Input & Voice */}
        <div className={styles.leftColumn}>
          {/* Text Input */}
          <div className={styles.textSection}>
            <textarea
              className={styles.textarea}
              placeholder="输入要合成的文字..."
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={8}
            />
            <div className={styles.textInfo}>
              <span>{text.length} 字符</span>
              <button
                onClick={() => setText('')}
                disabled={!text}
                className={styles.clearButton}
              >
                清空
              </button>
            </div>
          </div>

          {/* Voice Selection - engine dependent */}
          {engine === 'cosyvoice' ? (
            <VoiceSelector
              selectedVoiceId={selectedVoiceId}
              onVoiceSelect={setSelectedVoiceId}
              onDelete={handleDeleteVoice}
            />
          ) : (
            <EdgeTTSPanel
              selectedVoice={edgeVoice}
              onVoiceSelect={setEdgeVoice}
              onParamsChange={setEdgeParams}
            />
          )}
        </div>

        {/* Right Column: Params & Player & History */}
        <div className={styles.rightColumn}>
          {/* Parameter Controls (CosyVoice only) */}
          {engine === 'cosyvoice' && (
            <ParameterControls
              params={params}
              onParamChange={setParams}
            />
          )}

          {/* Generate Button */}
          <button
            onClick={handleSynthesize}
            disabled={isLoading || !canSynthesize}
            className={styles.generateButton}
          >
            {isLoading ? '生成中...' : '生成语音'}
          </button>

          {/* Audio Player */}
          <AudioPlayer result={result} isLoading={isLoading} />

          {/* Synthesis History */}
          <SynthesisHistory
            results={history}
            onDelete={handleDeleteResult}
            onPlay={handlePlayResult}
          />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify the app builds**

Run: `cd /Users/rio/repos/myprjs/voiceclone/frontend && npm run build 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/TTSSynthesis.tsx frontend/src/pages/TTSSynthesis.module.css
git commit -m "feat: add engine selector and integrate EdgeTTSPanel into TTS page"
```

---

### Task 10: End-to-end smoke test

**Files:**
- No file changes

- [ ] **Step 1: Start backend**

Run: `cd /Users/rio/repos/myprjs/voiceclone/backend && python -m uvicorn main:app --host 127.0.0.1 --port 8002`

- [ ] **Step 2: Test edge-voices endpoint**

Run: `curl -s http://127.0.0.1:8002/api/tts/edge-voices?language=Chinese | python -m json.tool | head -20`
Expected: JSON with `voices` array containing Chinese voices

- [ ] **Step 3: Test edge-languages endpoint**

Run: `curl -s http://127.0.0.1:8002/api/tts/edge-languages | python -m json.tool`
Expected: JSON with `languages` array

- [ ] **Step 4: Test synthesis with edge-tts**

Run: `curl -s -X POST http://127.0.0.1:8002/api/tts/synthesize -H "Content-Type: application/json" -d '{"text":"你好世界","engine":"edge_tts","edge_voice":"zh-CN-XiaoxiaoNeural"}' | python -m json.tool`
Expected: JSON with `audio_id` and `audio_url`

- [ ] **Step 5: Test existing CosyVoice still works**

Run: `curl -s http://127.0.0.1:8002/api/tts/voices | python -m json.tool | head -10`
Expected: Existing CosyVoice voices endpoint still returns data

- [ ] **Step 6: Start frontend and verify in browser**

Run: `cd /Users/rio/repos/myprjs/voiceclone/frontend && npm run dev`

Open http://localhost:5173, navigate to TTS page, verify:
- Engine selector tabs visible
- Switching to Edge-TTS shows voice filter and list
- Selecting a voice and clicking generate produces audio
- Switching back to CosyVoice shows original UI

---

## Self-Review Checklist

**Spec coverage:**
- [x] Engine selector on TTS page: Task 9
- [x] Edge-TTS panel with language/gender filter + voice list + basic params: Task 8
- [x] CosyVoice panel unchanged: Task 9 preserves existing components
- [x] Edge-TTS voice list from backend with filtering: Tasks 2, 4
- [x] Synthesis results and history shared: Task 4 uses same TTSResultRecord
- [x] EdgeTTSService with list_voices and synthesize: Task 2
- [x] EdgeVoice schema: Task 2
- [x] Modified TTSRequest: Task 4
- [x] edge-tts dependency: Task 1
- [x] Error handling: Task 4 (400 for missing params, 500 for failures)
- [x] Backend tests: Tasks 3, 5
- [x] Frontend types and API: Tasks 6, 7

**Placeholder scan:** No TBD, TODO, or vague steps found.

**Type consistency:**
- EdgeVoice type matches between backend (dict keys) and frontend (interface) across Tasks 2, 6, 7, 8
- TTSRequest `engine`, `edge_voice`, `edge_rate`, `edge_volume` fields consistent across Tasks 4, 6, 7, 9
- `get_edge_tts_service()` function name consistent across Tasks 2, 4, 5
