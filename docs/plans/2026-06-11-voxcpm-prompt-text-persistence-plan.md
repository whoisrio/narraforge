# Plan: VoxCPM Ultimate Clone — prompt_text 持久化到 VoiceProfile

## Context

VoxCPM 的 `/ultimate-clone` 接口需要 `prompt_text`（参考音频的完整文字转录）才能工作。当前这个值**每次合成时手动输入**，没有保存到 VoiceProfile。用户希望在**录入/上传声音时就填写 prompt_text**，后续使用 ultimate-clone 时自动读取。

## 数据流分析

当前：
```
用户每次在 VoxCPMPanel textarea 手动输入 prompt_text
    → TTSSynthesis 页面 voxcpmPromptText state
    → voxcpmApi.ultimateClone({ prompt_text })
    → 后端 /ultimate-clone 接口
    → voxcpm_service.synthesize(prompt_text=...)
```

目标：
```
录入/上传声音时填写 prompt_text
    → 保存到 VoiceProfile.prompt_text
    → ultimate-clone 使用时自动从 VoiceProfile 读取
    → VoxCPMPanel textarea 作为 fallback（VoiceProfile 没存就手动填）
```

## 涉及文件

### 后端 (4 files)
| 文件 | 变更 |
|------|------|
| `backend/app/models/voice_profile.py` | 新增 `prompt_text` Column |
| `backend/app/api/clone.py` | upload 接口接受 prompt_text；list 接口返回 prompt_text；PATCH 接口支持更新 prompt_text |
| `backend/app/api/voxcpm.py` | ultimate-clone: prompt_text 改为可选，未提供时从 VoiceProfile 读取 |

### 前端 (4 files)
| 文件 | 变更 |
|------|------|
| `frontend/src/types/index.ts` | VoiceProfile 接口新增 `prompt_text?: string` |
| `frontend/src/services/api.ts` | `voiceApi.upload()` 接受 prompt_text 参数 |
| `frontend/src/components/VoiceClone/AudioPreview.tsx` | 克隆前显示 prompt_text 输入框（engine=voxcpm 时必填） |
| `frontend/src/components/TTSSynthesis/VoxCPMPanel.tsx` | 选中声音后自动加载其 prompt_text 到 textarea |

## Task Dependency Graph

| Task | Depends On | Reason |
|------|------------|--------|
| Task 1: VoiceProfile model + migration | None | 数据模型是基础 |
| Task 2: Backend clone API 改造 | Task 1 | 需要 model 字段存在 |
| Task 3: Backend voxcpm ultimate-clone 改造 | Task 1 | 需要 model 字段存在 |
| Task 4: Frontend types + api.ts | Task 2 | 需要后端接口就绪 |
| Task 5: AudioPreview 组件 | Task 4 | 依赖 api.ts 变更 |
| Task 6: VoxCPMPanel 自动加载 | Task 4 | 依赖 types 变更 |

## Parallel Execution Graph

```
Wave 1 (immediate):
├── Task 1: VoiceProfile model + migration (backend, no deps)

Wave 2 (after Task 1):
├── Task 2: Backend clone API 改造 (depends: Task 1)
├── Task 3: Backend voxcpm ultimate-clone 改造 (depends: Task 1)

Wave 3 (after Task 2):
├── Task 4: Frontend types + api.ts (depends: Task 2)

Wave 4 (after Task 4):
├── Task 5: AudioPreview 组件 (depends: Task 4)
├── Task 6: VoxCPMPanel 自动加载 (depends: Task 4)

Critical path: Task 1 → Task 2 → Task 4 → Task 5
```

## Tasks

### Task 1: VoiceProfile 模型 + 数据库迁移

**Files:**
- Modify: `backend/app/models/voice_profile.py`

**Changes:**
1. 在 VoiceProfile 模型中新增字段：
   ```python
   prompt_text = Column(String, nullable=True)  # 参考音频的文字转录（VoxCPM Ultimate Clone 使用）
   ```
2. 数据库迁移：SQLite 直接 ALTER TABLE 添加列（SQLite 支持 ALTER TABLE ADD COLUMN）

**Acceptance Criteria:**
- [ ] VoiceProfile 模型有 prompt_text 字段
- [ ] 数据库表 voice_profiles 有 prompt_text 列
- [ ] 后端启动无报错

---

### Task 2: Backend clone API 改造

**Files:**
- Modify: `backend/app/api/clone.py`

**Changes:**
1. **`upload_voice` 端点**（POST /clone/upload）：
   - 新增可选 Form 参数 `prompt_text: str = Form(None)`
   - 创建 VoiceProfile 时保存 `prompt_text`

2. **`list_voices` 端点**（GET /clone/list）：
   - 返回值中新增 `prompt_text` 字段

3. **PATCH /clone/{voice_id}/description** 端点：
   - 扩展为同时支持更新 `description` 和 `prompt_text`
   - 或新增 PATCH /clone/{voice_id}/prompt-text 专用端点

4. **`upload_from_url` 端点**：同理支持 prompt_text

**Acceptance Criteria:**
- [ ] upload 接口可选传 prompt_text 并持久化
- [ ] list 接口返回 prompt_text
- [ ] PATCH 接口可更新 prompt_text

---

### Task 3: Backend voxcpm ultimate-clone 改造

**Files:**
- Modify: `backend/app/api/voxcpm.py`

**Changes:**
1. `VoxCPMUltimateCloneRequest.prompt_text` 从必填改为可选：
   ```python
   prompt_text: Optional[str] = Field(None, description="参考音频的完整转录文本（可选，未提供时自动从 VoiceProfile 读取）")
   ```
2. `ultimate_clone` 处理函数：
   - 如果 `request.prompt_text` 为空，从 VoiceProfile 读取 `voice.prompt_text`
   - 如果 VoiceProfile 也没有，返回 400 错误

**Acceptance Criteria:**
- [ ] prompt_text 参数可选
- [ ] 未提供时自动从 VoiceProfile 读取
- [ ] VoiceProfile 也没有时返回清晰错误信息

---

### Task 4: Frontend types + api.ts 改造

**Files:**
- Modify: `frontend/src/types/index.ts`
- Modify: `frontend/src/services/api.ts`

**Changes:**
1. **VoiceProfile 接口**新增：
   ```typescript
   prompt_text?: string;  // 参考音频的文字转录（VoxCPM Ultimate Clone 使用）
   ```

2. **voiceApi.upload()** 签名改造：
   ```typescript
   upload: async (file: File, promptText?: string): Promise<VoiceProfile> => {
     const formData = new FormData();
     formData.append('file', file);
     if (promptText) formData.append('prompt_text', promptText);
     // ...
   }
   ```

3. **voiceApi** 新增：
   ```typescript
   updatePromptText: async (id: string, promptText: string): Promise<void> => {
     await api.patch(`/clone/${id}/prompt-text`, { prompt_text: promptText });
   }
   ```

**Acceptance Criteria:**
- [ ] VoiceProfile 类型有 prompt_text 字段
- [ ] upload 函数可传 prompt_text
- [ ] 有独立的 updatePromptText API 函数

---

### Task 5: AudioPreview 组件 — 克隆前填写 prompt_text

**Files:**
- Modify: `frontend/src/components/VoiceClone/AudioPreview.tsx`

**Changes:**
1. 新增 state `promptText`
2. 当 `engine === 'voxcpm'` 时，在音频预览下方显示 textarea：
   - label: "参考音频转录（VoxCPM Ultimate Clone 需要）"
   - placeholder: "输入参考音频中说话人说的完整文字..."
   - 必填验证：未填时禁用克隆按钮
3. `handleClone` 中：
   - 上传时传入 promptText
   - `voiceApi.upload(file, promptText)`

4. **VoiceClone.tsx** 传递 engine prop 给 AudioPreview（已传）

**Acceptance Criteria:**
- [ ] VoxCPM 模式下显示 prompt_text 输入框
- [ ] 未填写时禁用克隆按钮
- [ ] 上传时 prompt_text 传给后端

---

### Task 6: VoxCPMPanel 自动加载 prompt_text

**Files:**
- Modify: `frontend/src/components/TTSSynthesis/VoxCPMPanel.tsx`
- Modify: `frontend/src/pages/TTSSynthesis.tsx`

**Changes:**
1. **VoxCPMPanel**：选中声音变化时，从 voices 列表中读取对应 voice 的 `prompt_text`，自动填充到 textarea
   ```tsx
   // 当 selectedVoiceId 变化时
   useEffect(() => {
     if (selectedVoiceId && mode === 'ultimate') {
       const voice = voices.find(v => v.id === selectedVoiceId);
       if (voice?.prompt_text) {
         onPromptTextChange(voice.prompt_text);
       }
     }
   }, [selectedVoiceId, voices]);
   ```

2. textarea 仍可手动编辑（作为 fallback/临时覆盖）

**Acceptance Criteria:**
- [ ] 选中声音后自动加载其 prompt_text
- [ ] textarea 仍可手动修改
- [ ] 切换声音时 prompt_text 跟着切换

---

## Commit Strategy

1. Task 1 单独 commit: `feat(model): add prompt_text to VoiceProfile`
2. Task 2+3 合并 commit: `feat(backend): persist prompt_text in clone/voxcpm APIs`
3. Task 4+5+6 合并 commit: `feat(frontend): prompt_text flow for VoxCPM ultimate clone`

## Success Criteria

1. 录入/上传声音时（VoxCPM 模式），填写 prompt_text 并随声音一起保存
2. TTS 合成页选择声音后，prompt_text 自动填充
3. ultimate-clone 接口 prompt_text 可选，自动从 VoiceProfile 读取
4. 现有非 VoxCPM 流程不受影响
