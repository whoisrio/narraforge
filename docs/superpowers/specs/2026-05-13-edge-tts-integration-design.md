# Edge-TTS Integration Design

## Summary

Add edge-tts as a parallel TTS engine alongside the existing CosyVoice engine. Users can freely switch between engines on the TTS page, with engine-specific UI panels adapting to available features.

## Requirements

- Engine selector on TTS page: CosyVoice | Edge-TTS
- When Edge-TTS selected: language/gender filter + voice list + basic params (rate, volume)
- When CosyVoice selected: existing UI unchanged
- Edge-TTS voice list fetched from backend with language/gender filtering
- Synthesis results and history shared across engines

## Backend

### New: EdgeTTSService (`app/services/edge_tts_service.py`)

```python
class EdgeTTSService:
    async def list_voices(self, language: str = None, gender: str = None) -> list[EdgeVoice]
    async def synthesize(self, text: str, voice: str, rate: str = "+0%", volume: str = "+0%") -> TTSSynthesisResult
```

- `list_voices`: calls `edge_tts.list_voices()`, filters by language/gender, returns cached result (1-hour TTL)
- `synthesize`: calls `edge_tts.Communicate(text, voice, rate=rate, volume=volume)`, saves mp3 to uploads, returns audio_id + audio_url
- `rate` format: `"+0%"`, `"+50%"`, `"-20%"` (edge-tts convention)
- `volume` format: same as rate

### New: EdgeVoice schema

```python
class EdgeVoice:
    name: str          # e.g. "zh-CN-XiaoxiaoNeural"
    short_name: str    # e.g. "Xiaoxiao"
    gender: str        # "Male" | "Female"
    locale: str        # e.g. "zh-CN"
    language: str      # derived display name, e.g. "Chinese"
```

### Modified: TTS API (`app/api/tts.py`)

**New endpoints:**
- `GET /api/tts/edge-voices` — query params: `language`, `gender`. Returns filtered voice list.

**Modified endpoint:**
- `POST /api/tts/synthesize` — request body adds `engine: str = "cosyvoice"`. When `engine == "edge_tts"`, routes to `EdgeTTSService.synthesize()`.

### Modified: TTSRequest schema

```python
class TTSRequest(BaseModel):
    text: str
    engine: str = "cosyvoice"      # "cosyvoice" | "edge_tts"
    # CosyVoice params (used when engine=cosyvoice)
    voice_id: str = ""
    language: str = "Chinese"
    speed: float = 1.0
    volume: float = 80
    pitch: int = 0
    emotion: str = "neutral"
    # Edge-TTS params (used when engine=edge_tts)
    edge_voice: str = ""           # e.g. "zh-CN-XiaoxiaoNeural"
    edge_rate: str = "+0%"
    edge_volume: str = "+0%"
```

### Dependencies

- Add `edge-tts` to `backend/requirements.txt`

### Not changed

- `TTSConfig` model unchanged
- CosyVoice service unchanged
- History/player logic unchanged

## Frontend

### Engine selector (`TTSSynthesis.tsx`)

Add a tab-style engine switcher at the top of the TTS page:

```
[ CosyVoice ] [ Edge-TTS ]
```

State: `engine: "cosyvoice" | "edge_tts"`, defaults to `"cosyvoice"`.

### Engine-specific panels

**CosyVoice panel** (unchanged): VoiceSelector + ParameterControls (full params)

**Edge-TTS panel** (new component: `EdgeTTSPanel.tsx`):

1. **Filter section** — two dropdowns:
   - Language: Chinese, English, Japanese, Korean, etc. (derived from available voices)
   - Gender: All, Male, Female

2. **Voice list** — grid of voice cards showing `short_name` (e.g. "Xiaoxiao") and locale tag. Selected card highlighted.

3. **Params section** — two sliders only:
   - Speed (rate): -50% to +100%, mapped to `edge_rate` string
   - Volume: -50% to +100%, mapped to `edge_volume` string

4. **Synthesize + AudioPlayer + SynthesisHistory** — reused from existing components

### API client changes (`services/api.ts`)

```typescript
// New
ttsApi.getEdgeVoices(language?: string, gender?: string): Promise<EdgeVoice[]>

// Modified
ttsApi.synthesize(request: TTSRequest): Promise<TTSResult>
// TTSRequest adds: engine, edge_voice, edge_rate, edge_volume
```

### New types

```typescript
interface EdgeVoice {
  name: string;       // "zh-CN-XiaoxiaoNeural"
  short_name: string; // "Xiaoxiao"
  gender: string;     // "Male" | "Female"
  locale: string;     // "zh-CN"
  language: string;   // "Chinese"
}
```

### Component tree

```
TTSSynthesis.tsx
├── EngineSelector (new: tab switcher)
├── CosyVoice panel (existing)
│   ├── VoiceSelector
│   └── ParameterControls
├── Edge-TTS panel (new)
│   ├── EdgeVoiceFilter (new)
│   ├── EdgeVoiceList (new)
│   └── EdgeTTSParams (new)
├── AudioPlayer (existing, shared)
└── SynthesisHistory (existing, shared)
```

## Data flow

1. User selects Edge-TTS engine → panel switches
2. Panel mounts → fetches voices with default filters (language=Chinese, gender=Female)
3. User changes filters → re-fetches voice list
4. User selects a voice, enters text, adjusts rate/volume → clicks synthesize
5. Frontend calls `POST /api/tts/synthesize` with `engine="edge_tts"`, `edge_voice`, `edge_rate`, `edge_volume`
6. Backend routes to EdgeTTSService → generates audio → returns audio_id + audio_url
7. AudioPlayer plays result, history records it

## Error handling

- edge-tts not installed → backend returns 500 with clear message
- Voice not found → 400 error
- Synthesis fails → return error with message from edge-tts exception
- Network timeout → edge-tts Communicate supports timeout param, set to 30s

## Testing

- Backend: unit tests for EdgeTTSService (mock edge_tts calls), API endpoint tests
- Frontend: component rendering tests for engine selector and edge-tts panel
- Integration: synthesize with edge-tts engine end-to-end
