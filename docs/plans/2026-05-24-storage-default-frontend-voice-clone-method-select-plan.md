# 存储模式默认前端 & 声音克隆方法选择 实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将默认存储模式改为 frontend，并为声音克隆添加逐步引导的方法选择流程（录制/上传/URL）

**Architecture:** 后端只需改一个默认值常量；前端 VoiceClone 页面引入三级状态机（选择方法 → 输入音频 → 预览克隆），新增 UrlInput 组件处理公网 URL 输入，扩展 AudioPreview 支持跳过上传直接克隆

**Tech Stack:** FastAPI + SQLAlchemy（后端），React + TypeScript + CSS Modules（前端）

**设计文档:** `docs/plans/2026-05-24-storage-default-frontend-voice-clone-method-select-design.md`

---

### Task 1: 存储模式默认值改为 frontend

**Files:**
- Modify: `backend/app/core/system_config_service.py:33`
- Modify: `frontend/src/hooks/useStorageMode.ts:7`
- Modify: `frontend/src/App.tsx:18,25`

**Step 1: 后端 — 修改默认值**

在 [system_config_service.py](file:///e:/repos/vcprjs/voice_clone/backend/app/core/system_config_service.py) 中，将 `get_storage_mode` 的默认参数改为 `STORAGE_MODE_FRONTEND`：

```python
# 改前 (L33)
    mode = get_config(db, "storage_mode", STORAGE_MODE_BACKEND)

# 改后
    mode = get_config(db, "storage_mode", STORAGE_MODE_FRONTEND)
```

**Step 2: 前端 — useStorageMode Context 默认值**

在 [useStorageMode.ts](file:///e:/repos/vcprjs/voice_clone/frontend/src/hooks/useStorageMode.ts) 中：

```typescript
// 改前 (L7)
  mode: 'backend',

// 改后
  mode: 'frontend',
```

**Step 3: 前端 — App.tsx 初始值和 fallback**

在 [App.tsx](file:///e:/repos/vcprjs/voice_clone/frontend/src/App.tsx) 中：

```typescript
// 改前 (L18)
  const [storageMode, setStorageMode] = useState<StorageMode>('backend');

// 改后
  const [storageMode, setStorageMode] = useState<StorageMode>('frontend');
```

```typescript
// 改前 (L25)
      () => console.warn('Failed to load storage mode, using default backend'),

// 改后
      () => console.warn('Failed to load storage mode, using default frontend'),
```

**Step 4: 验证**

```bash
cd backend && .venv\Scripts\python -m pytest tests/ -x -q
```

```bash
cd frontend && npm run build
```

**Step 5: Commit**

```bash
git add backend/app/core/system_config_service.py frontend/src/hooks/useStorageMode.ts frontend/src/App.tsx
git commit -m "feat: change default storage mode from backend to frontend"
```

---

### Task 2: api.ts 新增 uploadFromUrl 方法

**Files:**
- Modify: `frontend/src/services/api.ts`

**Step 1: 在 voiceApi 中新增方法**

在 [api.ts](file:///e:/repos/vcprjs/voice_clone/frontend/src/services/api.ts) 的 `voiceApi` 对象中，`upload` 方法之后追加：

```typescript
  /** 从公网 URL 下载音频并创建声音记录 */
  uploadFromUrl: async (audioUrl: string, name?: string): Promise<VoiceProfile> => {
    const { data } = await api.post<VoiceProfile>('/clone/upload-from-url', {
      audio_url: audioUrl,
      name,
    });
    return data;
  },
```

**Step 2: 验证编译**

```bash
cd frontend && npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add frontend/src/services/api.ts
git commit -m "feat: add voiceApi.uploadFromUrl method"
```

---

### Task 3: AudioPreview 扩展支持 voiceId prop（跳过上传）

**Files:**
- Modify: `frontend/src/components/VoiceClone/AudioPreview.tsx`

**Step 1: 扩展 Props 接口**

当前 `AudioPreview` 只接受 `file: File`，流程是：upload(file) → createClone(voiceId)。

新增 `voiceId` prop，当传入 `voiceId` 时跳过 upload 步骤。同时需要 `audioUrl` 用于播放预览：

```typescript
interface AudioPreviewProps {
  /** 文件模式：用户录制/上传的 File，组件负责 upload + clone */
  file?: File;
  /** URL 模式：已经通过 upload-from-url 创建好的 voice ID，直接 clone */
  voiceId?: string;
  /** URL 模式下用于预览播放的音频地址 */
  audioUrl?: string;
  onCloneSuccess: () => void;
  onCancel: () => void;
}
```

**Step 2: 修改 handleClone 逻辑**

```typescript
const handleClone = async () => {
    setIsCloning(true);
    setError('');

    let targetVoiceId: string;

    try {
      if (voiceId) {
        // URL 模式：已有 voice_id，跳过上传
        targetVoiceId = voiceId;
        setStep('cloning');
      } else if (file) {
        // 文件模式：先上传再克隆（现有逻辑）
        setStep('uploading');
        const uploadResult = await voiceApi.upload(file);
        targetVoiceId = uploadResult.id;
        setStep('cloning');
      } else {
        setError('缺少音频数据');
        return;
      }

      await voiceApi.createClone(targetVoiceId);

      if (file) {
        URL.revokeObjectURL(URL.createObjectURL(file));
      }
      onCloneSuccess();
    } catch (err) {
      console.error('Clone failed:', err);
      setError('克隆失败，请重试');
      setStep('idle');
    } finally {
      setIsCloning(false);
    }
  };
```

**Step 3: 修改文件预览区域**

当为 URL 模式时，使用传入的 `audioUrl` 播放：

```tsx
{/* 文件信息 */}
<div className={styles.fileInfo}>
  <span className={styles.fileIcon}>{voiceId ? '🌐' : '📁'}</span>
  <span className={styles.fileName}>
    {voiceId ? '外部音频' : file?.name}
  </span>
  {file && (
    <span className={styles.fileSize}>{(file.size / 1024).toFixed(1)} KB</span>
  )}
</div>

{/* 音频播放器 */}
<audio
  className={styles.audioPlayer}
  src={audioUrl || (file ? URL.createObjectURL(file) : '')}
  controls
/>
```

**Step 4: handleCancel 清理**

```typescript
const handleCancel = () => {
  if (file) {
    URL.revokeObjectURL(URL.createObjectURL(file));
  }
  onCancel();
};
```

**Step 5: 验证编译**

```bash
cd frontend && npx tsc --noEmit
```

**Step 6: Commit**

```bash
git add frontend/src/components/VoiceClone/AudioPreview.tsx
git commit -m "feat: extend AudioPreview to support voiceId prop for URL mode"
```

---

### Task 4: 新建 UrlInput 组件

**Files:**
- Create: `frontend/src/components/VoiceClone/UrlInput.tsx`
- Create: `frontend/src/components/VoiceClone/UrlInput.module.css`

**Step 1: 创建 UrlInput.module.css**

```css
.container {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.urlInput {
  width: 100%;
  padding: 0.625rem 0.75rem;
  border: 1px solid var(--color-border, #d1d5db);
  border-radius: var(--radius-md, 0.5rem);
  font-size: var(--font-size-base, 0.875rem);
  outline: none;
  transition: border-color 0.2s;
}

.urlInput:focus {
  border-color: var(--color-primary, #2563eb);
  box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.15);
}

.urlInput::placeholder {
  color: #9ca3af;
}

.confirmButton {
  padding: 0.5rem 1rem;
  background: var(--color-primary, #2563eb);
  color: #fff;
  border: none;
  border-radius: var(--radius-md, 0.5rem);
  cursor: pointer;
  font-size: var(--font-size-base, 0.875rem);
  font-weight: 500;
  transition: background-color 0.2s;
}

.confirmButton:hover:not(:disabled) {
  background: var(--color-primary-hover, #1d4ed8);
}

.confirmButton:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.error {
  color: var(--color-danger, #dc2626);
  font-size: 0.8125rem;
}

.hint {
  color: var(--color-text-secondary, #6b7280);
  font-size: 0.8125rem;
}
```

**Step 2: 创建 UrlInput.tsx**

```typescript
import { useState } from 'react';
import { voiceApi } from '../../services/api';
import type { VoiceProfile } from '../../types';
import styles from './UrlInput.module.css';

interface UrlInputProps {
  /** URL 确认完成后回调，传递创建好的声音记录 */
  onUrlConfirmed: (voice: VoiceProfile) => void;
  /** 用户点击返回 */
  onBack: () => void;
}

/**
 * 公网 URL 音频输入组件
 *
 * 用户输入公网可访问的音频 URL，确认后调用后端 upload-from-url 接口，
 * 后端验证 URL 可访问性并下载音频到 uploads 目录，同时保存 external_audio_url。
 */
export function UrlInput({ onUrlConfirmed, onBack }: UrlInputProps) {
  const [url, setUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleConfirm = async () => {
    const trimmed = url.trim();
    if (!trimmed) {
      setError('请输入音频文件地址');
      return;
    }

    // 简单的前端格式校验，真正的可达性由后端验证
    try {
      new URL(trimmed);
    } catch {
      setError('请输入有效的 URL 地址');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const result = await voiceApi.uploadFromUrl(trimmed);
      onUrlConfirmed(result);
    } catch (err: any) {
      const msg = err?.response?.data?.detail || err?.message || '下载失败';
      setError(`确认失败：${msg}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={styles.container}>
      <input
        className={styles.urlInput}
        type="url"
        placeholder="请输入音频文件的公网地址，如 https://example.com/audio.wav"
        value={url}
        onChange={(e) => { setUrl(e.target.value); setError(''); }}
        onKeyDown={(e) => e.key === 'Enter' && handleConfirm()}
        disabled={isLoading}
      />

      {error && <span className={styles.error}>{error}</span>}

      <div className={styles.hint}>
        支持 MP3、WAV、OGG 等音频格式。请确保链接可直接访问（无需登录）。
      </div>

      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <button
          className={styles.confirmButton}
          onClick={handleConfirm}
          disabled={isLoading || !url.trim()}
        >
          {isLoading ? '校验并下载中...' : '确认'}
        </button>
        <button
          className={styles.confirmButton}
          style={{ background: '#6b7280' }}
          onClick={onBack}
          disabled={isLoading}
        >
          返回
        </button>
      </div>
    </div>
  );
}
```

**Step 3: 更新 index.ts 导出**

在 `frontend/src/components/VoiceClone/index.ts` 末尾追加：

```typescript
export { UrlInput } from './UrlInput';
```

**Step 4: 验证编译**

```bash
cd frontend && npx tsc --noEmit
```

**Step 5: Commit**

```bash
git add frontend/src/components/VoiceClone/UrlInput.tsx frontend/src/components/VoiceClone/UrlInput.module.css frontend/src/components/VoiceClone/index.ts
git commit -m "feat: add UrlInput component for public URL voice input"
```

---

### Task 5: VoiceClone 页面重构 — 引入步骤状态机

**Files:**
- Modify: `frontend/src/pages/VoiceClone.tsx`
- Modify: `frontend/src/pages/VoiceClone.module.css`

**Step 1: 新增状态定义和步骤枚举**

在 `VoiceClone.tsx` 顶部替换现有逻辑：

```typescript
import { useState } from 'react';
import { AudioRecorder } from '../components/VoiceClone/AudioRecorder';
import { AudioUploader } from '../components/VoiceClone/AudioUploader';
import { AudioPreview } from '../components/VoiceClone/AudioPreview';
import { UrlInput } from '../components/VoiceClone/UrlInput';
import { VoiceList } from '../components/VoiceClone/VoiceList';
import type { VoiceProfile } from '../types';
import styles from './VoiceClone.module.css';

/** 克隆流程的三个步骤 */
type CloneStep = 'choose-method' | 'input' | 'preview-clone';

/** 用户选择的输入方式 */
type InputMethod = 'record' | 'upload' | 'url' | null;
```

**Step 2: 状态管理**

```typescript
export function VoiceClone() {
  const [step, setStep] = useState<CloneStep>('choose-method');
  const [method, setMethod] = useState<InputMethod>(null);

  /** 录制或上传后的 File 对象 */
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  /** URL 模式确认后返回的 voice 信息 */
  const [urlVoice, setUrlVoice] = useState<VoiceProfile | null>(null);

  /** 克隆成功或取消后重置所有状态 */
  const resetToChooseMethod = () => {
    setStep('choose-method');
    setMethod(null);
    setPendingFile(null);
    setUrlVoice(null);
  };
```

**Step 3: 方法选择卡片渲染（step === 'choose-method'）**

```typescript
  const renderMethodSelector = () => (
    <div className={styles.methodSelector}>
      <h2>选择声音来源</h2>
      <p className={styles.methodSelectorHint}>请选择一种方式提供声音样本</p>

      <div className={styles.methodCards}>
        <button
          className={styles.methodCard}
          onClick={() => { setMethod('record'); setStep('input'); }}
        >
          <span className={styles.methodIcon}>🎙️</span>
          <span className={styles.methodTitle}>实时录制</span>
          <span className={styles.methodDesc}>使用麦克风录制语音样本</span>
        </button>

        <button
          className={styles.methodCard}
          onClick={() => { setMethod('upload'); setStep('input'); }}
        >
          <span className={styles.methodIcon}>📁</span>
          <span className={styles.methodTitle}>上传文件</span>
          <span className={styles.methodDesc}>上传 MP3、WAV、WebM 音频文件</span>
        </button>

        <button
          className={styles.methodCard}
          onClick={() => { setMethod('url'); setStep('input'); }}
        >
          <span className={styles.methodIcon}>🌐</span>
          <span className={styles.methodTitle}>公网地址</span>
          <span className={styles.methodDesc}>提供已有音频文件的公网 URL</span>
        </button>
      </div>
    </div>
  );
```

**Step 4: 输入步骤渲染（step === 'input'）**

```typescript
  const renderInput = () => (
    <div className={styles.inputStep}>
      <button
        className={styles.backButton}
        onClick={() => { setStep('choose-method'); setMethod(null); }}
      >
        ← 返回选择方式
      </button>

      <div className={styles.methodPanel}>
        <h3>
          {method === 'record' && '🎙️ 实时录制'}
          {method === 'upload' && '📁 上传音频文件'}
          {method === 'url' && '🌐 公网音频地址'}
        </h3>

        {method === 'record' && (
          <AudioRecorder onRecordComplete={(file) => { setPendingFile(file); setStep('preview-clone'); }} />
        )}
        {method === 'upload' && (
          <AudioUploader onFileSelected={(file) => { setPendingFile(file); setStep('preview-clone'); }} />
        )}
        {method === 'url' && (
          <UrlInput
            onUrlConfirmed={(voice) => { setUrlVoice(voice); setStep('preview-clone'); }}
            onBack={() => { setStep('choose-method'); setMethod(null); }}
          />
        )}
      </div>
    </div>
  );
```

**Step 5: 预览克隆步骤渲染（step === 'preview-clone'）**

```typescript
  const renderPreview = () => (
    <div className={styles.previewStep}>
      <button
        className={styles.backButton}
        onClick={resetToChooseMethod}
      >
        ← 返回选择方式
      </button>

      {pendingFile && (
        <AudioPreview
          file={pendingFile}
          onCloneSuccess={() => resetToChooseMethod()}
          onCancel={() => resetToChooseMethod()}
        />
      )}

      {urlVoice && (
        <AudioPreview
          voiceId={urlVoice.id}
          audioUrl={urlVoice.audio_url}
          onCloneSuccess={() => resetToChooseMethod()}
          onCancel={() => resetToChooseMethod()}
        />
      )}
    </div>
  );
```

**Step 6: 主渲染逻辑**

```tsx
  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1>声音克隆</h1>
        <p>创建你自己的声音模型</p>
      </div>

      <div className={styles.content}>
        {/* 左侧：方法选择 / 输入 / 预览（根据步骤切换） */}
        <div className={styles.inputSection}>
          <div className={styles.card}>
            {step === 'choose-method' && renderMethodSelector()}
            {step === 'input' && renderInput()}
            {step === 'preview-clone' && renderPreview()}
          </div>
        </div>

        {/* 右侧：声音列表（始终显示） */}
        <div className={styles.listSection}>
          <div className={styles.card}>
            <VoiceList />
          </div>
        </div>
      </div>
    </div>
  );
}
```

**Step 7: 新增 CSS 样式**

在 `VoiceClone.module.css` 中追加以下样式（保留现有样式不变）：

```css
/* ---- 方法选择 ---- */
.methodSelector {
  text-align: center;
}

.methodSelector h2 {
  margin-bottom: var(--spacing-xs);
}

.methodSelectorHint {
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  margin-bottom: var(--spacing-lg);
}

.methodCards {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
}

.methodCard {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.25rem;
  width: 100%;
  padding: var(--spacing-md) var(--spacing-lg);
  background: var(--color-background);
  border: 2px solid var(--color-border-light);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: border-color 0.2s, box-shadow 0.2s;
  text-align: left;
  font-family: inherit;
}

.methodCard:hover {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.1);
}

.methodIcon {
  font-size: 1.5rem;
}

.methodTitle {
  font-size: var(--font-size-base);
  font-weight: 600;
}

.methodDesc {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}

/* ---- 输入步骤 ---- */
.inputStep,
.previewStep {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
}

.backButton {
  align-self: flex-start;
  background: none;
  border: none;
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  cursor: pointer;
  padding: 0;
  font-family: inherit;
}

.backButton:hover {
  color: var(--color-primary);
}

.methodPanel {
  background: var(--color-background);
  border-radius: var(--radius-md);
  padding: var(--spacing-md);
}

.methodPanel h3 {
  margin-bottom: var(--spacing-md);
  font-size: var(--font-size-lg);
}
```

**Step 8: 验证编译**

```bash
cd frontend && npx tsc --noEmit
```

**Step 9: Commit**

```bash
git add frontend/src/pages/VoiceClone.tsx frontend/src/pages/VoiceClone.module.css
git commit -m "feat: refactor VoiceClone page with step-based method selection flow"
```

---

### Task 6: 端到端验证

**Step 1: 启动后端**

```bash
cd backend && .venv\Scripts\python -m uvicorn main:app --host 127.0.0.1 --port 8002
```

**Step 2: 启动前端**

```bash
cd frontend && npm run dev
```

**Step 3: 验证存储模式默认值**

访问 `http://127.0.0.1:8002/api/config/storage-mode`，预期返回 `{"storage_mode":"frontend"}`。

**Step 4: 验证声音克隆方法选择流程**

1. 打开前端页面 → 声音克隆 tab
2. 应看到三个方法选择卡片（录制/上传/URL）
3. 点击「公网地址」→ 应看到 URL 输入框
4. 输入一个有效的公网音频 URL → 点击「确认」
5. 应进入预览页面，显示音频播放器
6. 点击「Clone Voice」→ 应完成克隆

**Step 5: 验证已有功能不受影响**

- 录制声音 → 上传 → 克隆 流程正常
- 上传文件 → 克隆 流程正常