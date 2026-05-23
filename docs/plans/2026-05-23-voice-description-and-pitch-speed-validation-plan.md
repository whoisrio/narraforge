# 声音描述功能 & Pitch/Speed 校验实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为克隆声音列表增加用户自定义描述（内联编辑），同时统一 pitch 参数为 float 比率制并加前后端校验

**Architecture:** 在 VoiceProfile 模型上新增 description 字段，新增专用 PATCH 端点更新描述，前端 VoiceList 组件增加内联编辑交互；pitch 从 int[-12,12] 改为 float[0.5,2.0]，Pydantic Field 添加 ge/le 校验

**Tech Stack:** FastAPI + SQLAlchemy + Pydantic (后端), React + TypeScript (前端)

---

### Task 1: VoiceProfile 模型新增 description 字段

**Files:**
- Modify: `backend/app/models/voice_profile.py`

**Step 1: 添加 description 列**

在 `VoiceProfile` 类的现有列定义之后添加：

```python
# 用户自定义的声音描述，用于替代无意义的 voice_id 显示
description = Column(String, nullable=True)
```

插入位置：在 `cloned_at` 和 `created_at` 之间。

**Step 2: 验证模型加载正常**

```bash
cd backend && ..\.venv\Scripts\python -c "from app.models.voice_profile import VoiceProfile; print('OK')"
```

---

### Task 2: 后端 PATCH /api/clone/{voice_id}/description 接口

**Files:**
- Modify: `backend/app/api/clone.py`

**Step 1: 新增 Pydantic 请求模型**

在文件顶部 Request Models 区域，`UploadFromUrlRequest` 之后添加：

```python
class UpdateDescriptionRequest(BaseModel):
    description: str = ""
```

**Step 2: 新增路由处理函数**

在 `/sync-from-qwen` 路由之后、文件末尾之前添加：

```python
@router.patch("/{voice_id}/description")
def update_voice_description(voice_id: str, request: UpdateDescriptionRequest, db: Session = Depends(get_db)):
    """
    更新声音的描述信息

    为什么需要专用接口而不是通用 PATCH：
    - 当前只有 description 一个可编辑字段，专用接口职责单一
    - 避免通用 PATCH 引入修改 voice_id/name 等敏感字段的安全隐患
    """
    voice = db.query(VoiceProfile).filter(VoiceProfile.id == voice_id).first()
    if not voice:
        raise HTTPException(status_code=404, detail="Voice not found")

    # 空字符串视为清除描述，统一存为 NULL 以简化前端判断逻辑
    voice.description = request.description.strip() or None
    db.commit()
    db.refresh(voice)

    return {
        "id": voice.id,
        "description": voice.description,
    }
```

**Step 3: 验证接口可访问**

启动后端后测试：

```bash
curl -X PATCH http://127.0.0.1:8002/api/clone/nonexistent/description -H "Content-Type: application/json" -d "{\"description\":\"test\"}"
```

预期返回 404。

---

### Task 3: GET /api/clone/list 返回 description 字段

**Files:**
- Modify: `backend/app/api/clone.py` (line ~318)

**Step 1: 在 /list 返回列表中添加 description**

在 `list_voices` 函数的返回字典列表中，`"id": v.id` 之后添加：

```python
"description": v.description,
```

---

### Task 4: 后端 Pitch/Speed Pydantic 校验

**Files:**
- Modify: `backend/app/api/tts.py`
- Modify: `backend/app/api/config.py`

**Step 1: 修改 tts.py 中的 Pydantic 模型**

在 `TTSRequest` 中，将：

```python
speed: float = 1.0
pitch: int = 0
```

改为（Field 需从 pydantic 导入）：

```python
from pydantic import BaseModel, Field

speed: float = Field(default=1.0, ge=0.5, le=2.0, description="语速比率，0.5-2.0")
pitch: float = Field(default=1.0, ge=0.5, le=2.0, description="音调比率，0.5-2.0")
```

同样修改 `BatchTTSRequest` 中的 speed 和 pitch。

**Step 2: 修改 config.py 中的 Pydantic 模型**

`ConfigCreate` 中：

```python
speed: float = Field(default=1.0, ge=0.5, le=2.0)
pitch: float = Field(default=1.0, ge=0.5, le=2.0)
```

`ConfigUpdate` 中：

```python
speed: Optional[float] = Field(default=None, ge=0.5, le=2.0)
pitch: Optional[float] = Field(default=None, ge=0.5, le=2.0)
```

**注意：** `Optional[float] = Field(default=None, ...)` 允许不传或传 null，但如果传了值就必须在范围内，Pydantic 的 ge/le 会自动处理。

**Step 3: 验证校验生效**

```bash
cd backend && ..\.venv\Scripts\python -c "
from pydantic import ValidationError
from app.api.tts import TTSRequest
try:
    r = TTSRequest(text='test', speed=3.0, voice_id='x')
    print('FAIL: should have raised')
except ValidationError as e:
    print('OK: speed=3.0 rejected')
try:
    r = TTSRequest(text='test', pitch=0.3, voice_id='x')
    print('FAIL: should have raised')
except ValidationError as e:
    print('OK: pitch=0.3 rejected')
"
```

---

### Task 5: 后端 Pitch 类型 int → float（模型层）

**Files:**
- Modify: `backend/app/models/tts_config.py`
- Modify: `backend/app/models/tts_result.py`

**Step 1: 修改 tts_config.py**

```python
# 将
pitch = Column(Integer, default=0)  # -12 到 +12
# 改为
pitch = Column(Float, default=1.0)  # 音调比率 0.5-2.0
```

**Step 2: 修改 tts_result.py**

```python
# 将
pitch = Column(Integer, default=0)
# 改为
pitch = Column(Float, default=1.0)
```

需确保文件顶部有 `from sqlalchemy import Float`，如果已有则无需改动。

---

### Task 6: 后端 Pitch 类型 int → float（服务层）

**Files:**
- Modify: `backend/app/services/qwen_tts_service.py`

需要将所有 `pitch: int = 0` 改为 `pitch: float = 1.0`。

涉及函数（按行号）：
- `synthesize_speech` (line ~116): `pitch: int = 0` → `pitch: float = 1.0`
- `_synthesize_speech_sync` (line ~148): 同上
- `_synthesize_speech_cosyvoice` (line ~170): 同上
- `_synthesize_speech_tts` (line ~247): 同上
- `clone_voice` (line ~339): 同上
- `_clone_voice_sync` (line ~369): 同上
- `_clone_voice_cosyvoice` (line ~391): 同上
- `_clone_voice_tts` (line ~468): 同上

以及 `synthesize_speech` 的 docstring (line ~128): `pitch: 音调 (-12 到 12)` → `pitch: 音调比率 (0.5-2.0)`

---

### Task 7: 后端 api/tts.py 中的 pitch 默认值更新

**Files:**
- Modify: `backend/app/api/tts.py`

在 `/synthesize` 和 `/synthesize/batch` 路由中，直接传递 pitch 值的地方（如 line 101, 231, 297），将默认值 `pitch=0` 改为 `pitch=1.0`。

注意 Task 4 已经修改了 Pydantic 模型，这里需要确认函数体中的调用是否使用 request 的值（已经是 float 了），主要是检查是否有硬编码的 `pitch=0` 默认值覆盖。

---

### Task 8: 前端类型定义更新

**Files:**
- Modify: `frontend/src/types/index.ts`

**Step 1: VoiceProfile 新增 description**

```typescript
export interface VoiceProfile {
  id: string;
  name: string;
  audio_url: string;
  description?: string;  // 用户自定义的声音描述
  qwen_voice_id?: string;
  // ...
}
```

**Step 2: TTSRequest / TTSResult / TTSConfig 中 pitch 注释更新**

将 `pitch?: number; // -12 to 12` 改为 `pitch?: number; // 0.5 - 2.0`

---

### Task 9: 前端 API 服务新增 updateDescription

**Files:**
- Modify: `frontend/src/services/api.ts`

在 `voiceApi` 对象中，`syncFromQwen` 之后添加：

```typescript
updateDescription: async (id: string, description: string): Promise<void> => {
  await api.patch(`/clone/${id}/description`, { description });
},
```

---

### Task 10: 前端 pitch 默认值 0 → 1.0

**Files:**
- Modify: `frontend/src/pages/TTSSynthesis.tsx`
- Modify: `frontend/src/components/TTS/ModelSelector.tsx`
- Modify: `frontend/src/components/TTS/TTSControls.tsx`
- Modify: `frontend/src/components/TTSSynthesis/ParameterControls.tsx`

**Step 1: TTSSynthesis.tsx**

- Line 30: `pitch: 0` → `pitch: 1.0`
- Line 58, 122, 137, 158, 208, 225: 将 `pitch ?? 0` 改为 `pitch ?? 1.0`

**Step 2: ModelSelector.tsx**

- Line 20: `pitch: 0` → `pitch: 1.0`
- Line 42: `pitch: 0` → `pitch: 1.0`

**Step 3: TTSControls.tsx**

- Line 20: `const [pitch, setPitch] = useState(0)` → `useState(1.0)`
- Line 203: pitch slider `min={-12}` `max={12}` `step={1}` → `min={0.5}` `max={2}` `step={0.1}`

**Step 4: ParameterControls.tsx**

- Line 93: `语调: {params.pitch ?? 0}` → `语调: {(params.pitch ?? 1.0).toFixed(1)}`
- Line 95: `min="-12"` `max="12"` `step="1"` → `min="0.5"` `max="2.0"` `step="0.1"`
- Line 102: `value={params.pitch ?? 0}` → `value={params.pitch ?? 1.0}`
- Line 103: `parseInt(e.target.value)` → `parseFloat(e.target.value)`

---

### Task 11: 前端 VoiceList 内联编辑

**Files:**
- Modify: `frontend/src/components/VoiceClone/VoiceList.tsx`

**Step 1: 新增状态变量**

在组件顶部 states 区域添加：

```typescript
const [editingId, setEditingId] = useState<string | null>(null);
const [editingDescription, setEditingDescription] = useState('');
const [savingId, setSavingId] = useState<string | null>(null);
```

**Step 2: 新增处理函数**

```typescript
const handleStartEdit = (voice: VoiceProfile) => {
  setEditingId(voice.id);
  setEditingDescription(voice.description || '');
};

const handleCancelEdit = () => {
  setEditingId(null);
  setEditingDescription('');
};

const handleSaveDescription = async (voiceId: string) => {
  // 值没变化则不请求
  const voice = voices.find(v => v.id === voiceId);
  if (!voice) return;
  if (editingDescription.trim() === (voice.description || '')) {
    setEditingId(null);
    return;
  }

  setSavingId(voiceId);
  try {
    await voiceApi.updateDescription(voiceId, editingDescription.trim());
    // 更新本地 state
    setVoices(prev => prev.map(v =>
      v.id === voiceId ? { ...v, description: editingDescription.trim() || undefined } : v
    ));
    setEditingId(null);
  } catch (err) {
    console.error('Failed to save description:', err);
    // 恢复原值，结束编辑
    setEditingId(null);
  } finally {
    setSavingId(null);
  }
};
```

**Step 3: 修改列表渲染** — 替换 `voiceNameStyle` 和 `voiceMetaStyle` 区域的渲染逻辑

将卡片中 voice 标题区域（`<div style={voiceNameStyle}>{voice.name}</div>` 之后的代码）改为：

```tsx
{editingId === voice.id ? (
  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
    <input
      type="text"
      value={editingDescription}
      onChange={(e) => setEditingDescription(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') handleSaveDescription(voice.id);
        if (e.key === 'Escape') handleCancelEdit();
      }}
      onBlur={() => handleSaveDescription(voice.id)}
      disabled={savingId === voice.id}
      autoFocus
      style={{
        padding: '2px 6px',
        fontSize: 'var(--font-size-base)',
        fontWeight: 'var(--font-weight-medium)',
        border: '1px solid var(--color-primary)',
        borderRadius: '4px',
        width: '200px',
      }}
    />
    <Button variant="ghost" size="xs" onClick={() => handleSaveDescription(voice.id)} disabled={savingId === voice.id}>✓</Button>
    <Button variant="ghost" size="xs" onClick={handleCancelEdit}>✕</Button>
  </div>
) : (
  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
    <div style={voiceNameStyle}>
      {voice.description || voice.qwen_voice_id || 'N/A'}
    </div>
    <span
      onClick={() => handleStartEdit(voice)}
      style={{ cursor: 'pointer', fontSize: '12px', opacity: 0.6 }}
      title="编辑描述"
    >
      ✏️
    </span>
  </div>
)}
```

同时可以在 `voiceMetaStyle` 区域移除 `ID: {voice.qwen_voice_id || 'N/A'}` 这部分，因为已经在标题处显示了。

---

### Task 12: 更新前端测试中的 pitch 默认值

**Files:**
- Modify: `frontend/src/__tests__/pages/TTSSynthesis.test.tsx`
- Modify: `frontend/src/__tests__/components/AudioPlayer.test.tsx`
- Modify: `frontend/src/__tests__/components/ParameterControls.test.tsx`

将所有测试数据中的 `pitch: 0` 改为 `pitch: 1.0`。

---

### Task 13: 编写后端 API 测试

**Files:**
- Create: `tests/webapp-testing/test_voice_description.py`

```python
"""
声音描述功能 API 测试
"""

import requests

BACKEND_URL = "http://127.0.0.1:8002"


def test_update_description_not_found():
    """测试更新不存在声音的描述应返回 404"""
    print("\n" + "="*60)
    print("测试: 更新不存在声音的描述 -> 404")
    print("="*60)

    resp = requests.patch(
        f"{BACKEND_URL}/api/clone/nonexistent-id/description",
        json={"description": "test"},
        timeout=10
    )
    assert resp.status_code == 404, f"Expected 404, got {resp.status_code}"
    print("✅ 正确返回 404")


def test_pitch_speed_validation():
    """测试 Pydantic pitch/speed 校验"""
    print("\n" + "="*60)
    print("测试: pitch/speed 范围校验")
    print("="*60)

    # speed 超范围
    resp = requests.post(
        f"{BACKEND_URL}/api/tts/synthesize",
        json={"text": "test", "speed": 3.0, "voice_id": "x"},
        timeout=10
    )
    assert resp.status_code == 422, f"Expected 422 for invalid speed, got {resp.status_code}"
    print("✅ speed=3.0 被拒绝 (422)")

    # pitch 超范围
    resp = requests.post(
        f"{BACKEND_URL}/api/tts/synthesize",
        json={"text": "test", "pitch": 0.1, "voice_id": "x"},
        timeout=10
    )
    assert resp.status_code == 422, f"Expected 422 for invalid pitch, got {resp.status_code}"
    print("✅ pitch=0.1 被拒绝 (422)")

    # 边界值应该通过（返回 500 或 200，取决于 voice_id 是否存在，但不应 422）
    resp = requests.post(
        f"{BACKEND_URL}/api/tts/synthesize",
        json={"text": "test", "speed": 0.5, "pitch": 2.0, "voice_id": "x"},
        timeout=10
    )
    assert resp.status_code != 422, f"边界值不应返回 422, got {resp.status_code}"
    print("✅ speed=0.5, pitch=2.0 通过校验")


if __name__ == "__main__":
    test_update_description_not_found()
    test_pitch_speed_validation()
    print("\n" + "="*60)
    print("所有测试通过!")
```

**Step 2: 运行测试**

```bash
cd backend && ..\.venv\Scripts\python ../tests/webapp-testing/test_voice_description.py
```

---

### Task 14: 更新前端 VoiceClone 测试

**Files:**
- Modify: `frontend/src/__tests__/pages/VoiceClone.test.tsx`

确认现有测试仍能通过。如有需要，mock `voiceApi.updateDescription`。

---

### Task 15: 验证 & 提交

**Step 1: 验证后端**

```bash
# 启动后端
cd backend && ..\.venv\Scripts\python -m uvicorn main:app --host 127.0.0.1 --port 8002 --reload

# 另一个终端运行测试
..\.venv\Scripts\python tests/webapp-testing/test_voice_description.py
```

**Step 2: 验证前端构建**

```bash
cd frontend && npm run build
```

**Step 3: 验证前端 lint**

```bash
cd frontend && npm run lint
```

**Step 4: 提交**

```bash
git add .
git commit -m "feat: add voice description inline editing and pitch/speed validation

- Add description column to VoiceProfile model
- Add PATCH /api/clone/{voice_id}/description endpoint
- Add inline edit UI for voice description in VoiceList
- Change pitch from int(-12..12) to float(0.5..2.0) ratio
- Add Pydantic Field ge/le validation for pitch and speed
- Update frontend defaults and slider ranges"
```