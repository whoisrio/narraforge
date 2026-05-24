# CosyVoice 复刻指令 + SSML/过滤开关 实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将 CosyVoice 合成参数从无效的「语气(emotion)」改为「复刻指令(instruction)」，并新增 SSML 开关和 Markdown 过滤开关。

**Architecture:** 后端 TTSRequest 移除 emotion、instruction 改为用户输入值、新增 enable_ssml/enable_markdown_filter；前端 ParameterControls 将 emotion 下拉替换为 instruction 文本输入+预设按钮+两个开关，并 localStorage 持久化。

**Tech Stack:** Python FastAPI + React TypeScript + SQLAlchemy + localStorage

---

### Task 1: 后端 TTSRequest 模型 & TTSResultRecord 模型变更

**Files:**
- Modify: `backend/app/api/tts.py:29-55`
- Modify: `backend/app/models/tts_result.py:23`
- Modify: `backend/app/api/tts.py:57-71` (`_result_to_dict`)

**Step 1: 修改 TTSRequest — 删除 emotion，改 instruction 默认值，新增 enable_ssml/enable_markdown_filter**

在 `backend/app/api/tts.py` 中，修改 `TTSRequest` 类：

```python
class TTSRequest(BaseModel):
    text: str
    engine: str = "cosyvoice"  # "cosyvoice" | "edge_tts"
    # CosyVoice params
    voice_id: str = ""
    instruction: str = "音调偏高，语速中等，充满活力和感染力，适合广告配音"
    speed: float = Field(default=1.0, ge=0.5, le=2.0, description="语速比率，0.5-2.0")
    volume: float = 80
    pitch: float = Field(default=1.0, ge=0.5, le=2.0, description="音调比率，0.5-2.0")
    language: str = "Chinese"
    format: str = "wav"
    enable_ssml: bool = False
    enable_markdown_filter: bool = False
    # Edge-TTS params
    edge_voice: str = ""
    edge_rate: str = "+0%"
    edge_volume: str = "+0%"
```

**Step 2: 修改 BatchTTSRequest — 删除 emotion**

```python
class BatchTTSRequest(BaseModel):
    segments: List[SegmentRequest]
    voice_id: str
    speed: float = Field(default=1.0, ge=0.5, le=2.0, description="语速比率，0.5-2.0")
    volume: float = 80
    pitch: float = Field(default=1.0, ge=0.5, le=2.0, description="音调比率，0.5-2.0")
```

**Step 3: 修改 `_result_to_dict` — emotion 替换为 instruction**

```python
def _result_to_dict(r: TTSResultRecord) -> dict:
    return {
        "id": r.id,
        "text": r.text,
        "voice_id": r.voice_id,
        "voice_name": r.voice_name,
        "audio_url": f"/api/tts/audio/{r.id}",
        "audio_format": r.audio_format,
        "speed": r.speed,
        "volume": r.volume,
        "pitch": r.pitch,
        "instruction": r.instruction,
        "language": r.language,
        "created_at": r.created_at.isoformat() if r.created_at else None,
    }
```

**Step 4: 修改 `TTSResultRecord` 模型 — emotion 列改为 instruction**

在 `backend/app/models/tts_result.py` 中：

```python
instruction = Column(String, default="音调偏高，语速中等，充满活力和感染力，适合广告配音")
```

替换原来的 `emotion = Column(String, default="neutral")`

---

### Task 2: 后端 synthes 路由透传新参数

**Files:**
- Modify: `backend/app/api/tts.py:85-150` (`_synthesize_cosyvoice`)

**Step 1: 修改 `_synthesize_cosyvoice` — 传递 enable_ssml/enable_markdown_filter 到 service，emotion 改为 instruction**

找到 `tts_service.synthesize_speech(...)` 调用处，添加新参数：

```python
audio_path = await tts_service.synthesize_speech(
    voice_id=request.voice_id,
    text=request.text,
    speed=request.speed,
    volume=request.volume,
    pitch=request.pitch,
    format=audio_fmt,
    sample_rate=16000,
    instruction=request.instruction,
    enable_ssml=request.enable_ssml,
    enable_markdown_filter=request.enable_markdown_filter,
)
```

**Step 2: 修改返回的 params 字典 — emotion 改为 instruction，增加开关值**

前端存储模式返回：
```python
"params": {
    "speed": request.speed,
    "volume": request.volume,
    "pitch": request.pitch,
    "instruction": request.instruction,
    "enable_ssml": request.enable_ssml,
    "enable_markdown_filter": request.enable_markdown_filter,
    "voice_id": request.voice_id,
}
```

后端存储模式 — 创建 record 时：
```python
record = TTSResultRecord(
    id=audio_id,
    text=request.text,
    voice_id=request.voice_id,
    voice_name=voice_name,
    audio_path=audio_path,
    audio_format=audio_fmt,
    speed=request.speed,
    volume=request.volume,
    pitch=request.pitch,
    instruction=request.instruction,
    language=request.language,
)
```

返回 params 同上。

---

### Task 3: 后端 Service 层 — synthesize_speech 和 _synthesize_voice_cosyvoice

**Files:**
- Modify: `backend/app/services/qwen_tts_service.py:332-388` (`synthesize_speech`, `_synthesize_speech_sync`)
- Modify: `backend/app/services/qwen_tts_service.py:465-560` (`_synthesize_voice_cosyvoice`)

**Step 1: `synthesize_speech` 签名新增参数**

```python
async def synthesize_speech(
    self,
    voice_id: str,
    text: str,
    instruction: str,
    speed: float = 1.0,
    volume: float = 80,
    pitch: float = 1.0,
    format: str = "wav",
    sample_rate: int = 16000,
    enable_ssml: bool = False,
    enable_markdown_filter: bool = False,
) -> bytes:
```

透传到 `_synthesize_speech_sync`。

**Step 2: `_synthesize_speech_sync` 签名新增参数**

```python
def _synthesize_speech_sync(
    self,
    voice_id: str,
    text: str,
    instruction: str,
    speed: float = 1.0,
    volume: float = 80,
    pitch: float = 1.0,
    format: str = "wav",
    sample_rate: int = 16000,
    enable_ssml: bool = False,
    enable_markdown_filter: bool = False,
) -> bytes:
```

调用 `_synthesize_voice_cosyvoice` 时透传。

**Step 3: `_synthesize_voice_cosyvoice` 签名新增参数，ops 不再硬编码**

```python
def _synthesize_voice_cosyvoice(
    self,
    voice_id: str,
    text: str,
    instruction: str = "字正腔圆，播音腔",
    speed: float = 1.0,
    volume: float = 80,
    pitch: float = 1.0,
    format: str = "mp3",
    sample_rate: int = 16000,
    enable_ssml: bool = False,
    enable_markdown_filter: bool = False,
) -> str:
```

ops 字典修改：
```python
ops = {
    "instruction": instruction,
    "speed": speed,
    "volume": volume,
    "pitch": pitch,
    "enable_ssml": enable_ssml,
    "enable_markdown_filter": enable_markdown_filter,
}
```

删除原有硬编码注释 `#"enable_markdown_filter": True, #默认启动markdown标记过滤`

---

### Task 4: 前端类型定义变更

**Files:**
- Modify: `frontend/src/types/index.ts`

**Step 1: 修改 TTSRequest**

```typescript
export interface TTSRequest {
  text: string;
  engine?: 'cosyvoice' | 'edge_tts';
  voice_id: string;
  language?: 'Chinese' | 'English' | 'Japanese' | 'Korean';
  speed?: number;
  volume?: number;
  pitch?: number;
  instruction?: string;
  enable_ssml?: boolean;
  enable_markdown_filter?: boolean;
  format?: 'mp3' | 'wav';
  // Edge-TTS params
  edge_voice?: string;
  edge_rate?: string;
  edge_volume?: string;
}
```

**Step 2: 修改 TTSResult.params**

```typescript
export interface TTSResult {
  audio_id: string;
  audio_url?: string;
  audio_base64?: string;
  audio_format?: string;
  voice_id?: string;
  voice_name?: string;
  text: string;
  params: {
    voice_id?: string;
    speed?: number;
    volume?: number;
    pitch?: number;
    language?: string;
    instruction?: string;
    enable_ssml?: boolean;
    enable_markdown_filter?: boolean;
    engine?: string;
    edge_voice?: string;
    edge_rate?: string;
    edge_volume?: string;
  };
}
```

**Step 3: 修改 TTSResultRecord**

```typescript
export interface TTSResultRecord {
  id: string;
  text: string;
  voice_id: string;
  voice_name: string;
  audio_url: string;
  audio_format: string;
  speed: number;
  volume: number;
  pitch: number;
  instruction: string;
  language: string;
  created_at: string;
}
```

**Step 4: 修改 TTSLocalRecord**

```typescript
export interface TTSLocalRecord {
  id: string;
  text: string;
  voice_id: string;
  voice_name: string;
  audioBlob: Blob;
  audio_format: string;
  speed: number;
  volume: number;
  pitch: number;
  instruction: string;
  language: string;
  created_at: string;
}
```

---

### Task 5: 前端 ParameterControls 组件重写

**Files:**
- Modify: `frontend/src/components/TTSSynthesis/ParameterControls.tsx`
- Modify: `frontend/src/components/TTSSynthesis/ParameterControls.module.css`

**Step 1: 重写 ParameterControls.tsx**

预设复刻指令常量：

```typescript
const INSTRUCTION_PRESETS = [
  { label: '广告配音', value: '音调偏高，语速中等，充满活力和感染力，适合广告配音' },
  { label: '播音主持', value: '吐字清晰精准，字正腔圆' },
  { label: '温柔治愈', value: '语速偏慢，音调温柔甜美，语气治愈温暖，像贴心朋友般关怀' },
] as const;

const DEFAULT_INSTRUCTION = INSTRUCTION_PRESETS[0].value;
```

localStorage key: `cosyvoice_params`

存储/读取逻辑：
- 初始化时从 localStorage 读取 `instruction`、`enable_ssml`、`enable_markdown_filter`
- 值变更时写入 localStorage
- 首次使用无存储值时，默认填入广告配音指令

组件 props 接口新增 `instruction`、`enable_ssml`、`enable_markdown_filter`。

新增 UI 控件：
1. 复刻指令输入框（`<input type="text" maxLength={50}>`），下方显示字符计数
2. 预设按钮行（3 个 button，点击填入对应 value）
3. SSML 开关（toggle）
4. 过滤 Markdown 标记开关（toggle）

删除原有的 emotion 下拉框。

**Step 2: 更新 ParameterControls.module.css**

新增样式：
- `.instructionSection` — 复刻指令区域容器
- `.instructionInput` — 输入框样式
- `.presetButtons` — 预设按钮行
- `.presetButton` — 单个预设按钮（选中态高亮）
- `.toggles` — 开关区域
- `.toggle` — 单个开关行

---

### Task 6: 前端 TTSSynthesis.tsx 主页面适配

**Files:**
- Modify: `frontend/src/pages/TTSSynthesis.tsx`

**Step 1: params state 删除 emotion，增加 instruction/enable_ssml/enable_markdown_filter**

```typescript
const [params, setParams] = useState<Partial<TTSRequest>>({
    language: 'Chinese',
    speed: 1.0,
    volume: 80,
    pitch: 1.0,
    instruction: '音调偏高，语速中等，充满活力和感染力，适合广告配音',
    enable_ssml: false,
    enable_markdown_filter: false,
});
```

**Step 2: synthesize 请求中删除 emotion，添加 instruction/enable_ssml/enable_markdown_filter**

```typescript
const response = await ttsApi.synthesize({
    text,
    voice_id: selectedVoiceId,
    language: params.language || 'Chinese',
    speed: params.speed ?? 1.0,
    volume: params.volume ?? 80,
    pitch: params.pitch ?? 1.0,
    instruction: params.instruction || '',
    enable_ssml: params.enable_ssml ?? false,
    enable_markdown_filter: params.enable_markdown_filter ?? false,
    format: 'mp3',
});
```

**Step 3: saveTTSResult 调用中 emotion 改为 instruction**

```typescript
await saveTTSResult({
    ...
    instruction: response.params.instruction || '',
    ...
});
```

**Step 4: handlePlayResult 中 params.emotion 改为 params.instruction**

```typescript
params: {
    voice_id: record.voice_id,
    speed: record.speed,
    volume: record.volume,
    pitch: record.pitch,
    language: record.language,
    instruction: record.instruction,
},
```

---

### Task 7: 前端旧版 TTSControls.tsx 适配

**Files:**
- Modify: `frontend/src/components/TTS/TTSControls.tsx`

**Step 1: 删除 emotion state 和相关 UI**

- 删除 `const [emotion, setEmotion] = useState('neutral');`
- 删除 `emotionOptions` 常量
- 删除 emotion 的 Select 组件
- 删除 handleSynthesize 中请求的 `emotion` 字段
- 删除结果显示中的 `emotion`

这个组件功能已基本被 TTSSynthesis 替代，做最小改动即可。

---

### Task 8: 验证

**Step 1: 重启后端确认无语法错误**

```bash
cd backend && .venv\Scripts\python.exe -c "from app.api.tts import TTSRequest; print(TTSRequest.model_fields.keys())"
```

**Step 2: 确认前端类型检查通过**

```bash
cd frontend && npx tsc --noEmit
```

预期：无类型错误。