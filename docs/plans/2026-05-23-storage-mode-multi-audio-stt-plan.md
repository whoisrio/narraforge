# 存储模式切换 & 多音频拼接字幕识别 实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 增加「前端/后端存储」双模式切换、Tab 切换保持页面内容、多音频拼接字幕识别功能。

**Architecture:** 后端新增 `system_config` 表控制存储模式；前端新增 IndexedDB 层在前端模式下接管存储；三个页面从条件渲染改为 CSS 显隐保持状态；STT 页新增从 TTS 历史选择多音频 → ffmpeg 拼接 → 统一识别的交互。

**Tech Stack:** Python/FastAPI/SQLAlchemy（后端）, React/TypeScript/IndexedDB（前端）, ffmpeg（音频拼接）

---

### Task 1: 后端 - system_config 模型及初始化

**Files:**
- Create: `backend/app/models/system_config.py`
- Modify: `backend/app/models/__init__.py`
- Create: `backend/app/core/system_config_service.py`

**Step 1: 创建 system_config 模型**

```python
# backend/app/models/system_config.py
from sqlalchemy import Column, String, DateTime
from datetime import datetime
from app.core.database import Base


class SystemConfig(Base):
    """系统级配置键值存储，用于跨会话持久化的全局设置"""
    __tablename__ = "system_configs"

    key = Column(String, primary_key=True)
    value = Column(String, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
```

**Step 2: 注册模型到 __init__.py**

在 `backend/app/models/__init__.py` 末尾追加：

```python
from app.models.system_config import SystemConfig
```

**Step 3: 创建 system_config_service 工具函数**

```python
# backend/app/core/system_config_service.py
from sqlalchemy.orm import Session
from app.models.system_config import SystemConfig

# 存储模式允许的值
STORAGE_MODE_BACKEND = "backend"
STORAGE_MODE_FRONTEND = "frontend"
VALID_STORAGE_MODES = {STORAGE_MODE_BACKEND, STORAGE_MODE_FRONTEND}


def get_config(db: Session, key: str, default: str = "") -> str:
    """读取配置值，不存在时返回 default"""
    row = db.query(SystemConfig).filter(SystemConfig.key == key).first()
    return row.value if row else default


def set_config(db: Session, key: str, value: str) -> None:
    """写入配置值（upsert）"""
    row = db.query(SystemConfig).filter(SystemConfig.key == key).first()
    if row:
        row.value = value
    else:
        row = SystemConfig(key=key, value=value)
        db.add(row)
    db.commit()


def get_storage_mode(db: Session) -> str:
    """获取当前存储模式，默认 backend"""
    mode = get_config(db, "storage_mode", STORAGE_MODE_BACKEND)
    if mode not in VALID_STORAGE_MODES:
        return STORAGE_MODE_BACKEND
    return mode


def set_storage_mode(db: Session, mode: str) -> None:
    """设置存储模式"""
    if mode not in VALID_STORAGE_MODES:
        raise ValueError(f"Invalid storage mode: {mode}")
    set_config(db, "storage_mode", mode)


def is_frontend_storage(db: Session) -> bool:
    """判断当前是否为前端存储模式"""
    return get_storage_mode(db) == STORAGE_MODE_FRONTEND
```

**Step 4: 验证**

```bash
cd backend && .venv\Scripts\python -c "from app.models.system_config import SystemConfig; print('OK')"
```

**Step 5: Commit**

```bash
git add backend/app/models/system_config.py backend/app/models/__init__.py backend/app/core/system_config_service.py
git commit -m "feat: add system_config model and storage mode service"
```

---

### Task 2: 后端 - 存储模式 API

**Files:**
- Modify: `backend/app/api/config.py`

**Step 1: 在 config.py 末尾新增两个端点**

在 [config.py](file:///e:/repos/vcprjs/voice_clone/backend/app/api/config.py) 文件末尾追加：

```python
from pydantic import BaseModel
from app.core.system_config_service import get_storage_mode, set_storage_mode, STORAGE_MODE_BACKEND, STORAGE_MODE_FRONTEND


class StorageModeRequest(BaseModel):
    storage_mode: str  # "backend" | "frontend"


@router.get("/storage-mode")
def get_storage_mode_endpoint(db: Session = Depends(get_db)):
    """获取当前存储模式"""
    mode = get_storage_mode(db)
    return {"storage_mode": mode}


@router.put("/storage-mode")
def set_storage_mode_endpoint(data: StorageModeRequest, db: Session = Depends(get_db)):
    """设置存储模式"""
    if data.storage_mode not in (STORAGE_MODE_BACKEND, STORAGE_MODE_FRONTEND):
        from fastapi import HTTPException
        raise HTTPException(
            status_code=400,
            detail=f"Invalid storage_mode: {data.storage_mode}. Must be 'backend' or 'frontend'"
        )
    set_storage_mode(db, data.storage_mode)
    return {"storage_mode": data.storage_mode}
```

**Step 2: 验证 API**

```bash
cd backend && .venv\Scripts\python -m uvicorn main:app --host 127.0.0.1 --port 8002 &
```
```bash
curl http://127.0.0.1:8002/api/config/storage-mode
# 期望: {"storage_mode":"backend"}
curl -X PUT http://127.0.0.1:8002/api/config/storage-mode -H "Content-Type: application/json" -d '{"storage_mode":"frontend"}'
# 期望: {"storage_mode":"frontend"}
curl http://127.0.0.1:8002/api/config/storage-mode
# 期望: {"storage_mode":"frontend"}
curl -X PUT http://127.0.0.1:8002/api/config/storage-mode -H "Content-Type: application/json" -d '{"storage_mode":"backend"}'
```

**Step 3: Commit**

```bash
git add backend/app/api/config.py
git commit -m "feat: add storage-mode config API endpoints"
```

---

### Task 3: 后端 - TTS 合成接口适配双模式

**Files:**
- Modify: `backend/app/api/tts.py`

**Step 1: 修改 `_synthesize_cosyvoice` 支持前端模式**

在 `backend/app/api/tts.py` 顶部添加 import：

```python
from app.core.system_config_service import is_frontend_storage
import base64
```

修改 `_synthesize_cosyvoice` 函数（约 L96-L148），将原来「保存记录+返回 info」的逻辑改为分支：

```python
async def _synthesize_cosyvoice(request: TTSRequest, db: Session = Depends(get_db)):
    """CosyVoice 引擎合成 - 根据存储模式决定是否持久化"""
    audio_fmt = request.format or "mp3"

    logger.info(f'request is: {request}')
    if not request.voice_id:
        raise HTTPException(status_code=400, detail="voice_id is required")

    try:
        tts_service = await get_tts_service()
        logger.info(f"Synthesizing with cloned voice: {request.voice_id}")

        audio_path = await tts_service.clone_voice(
            voice_id=request.voice_id,
            text=request.text,
            speed=request.speed,
            volume=request.volume,
            pitch=request.pitch,
            format=audio_fmt,
            sample_rate=16000,
            instruction=request.instruction,
        )

        audio_id = Path(audio_path).stem

        # 查询声音名称
        voice = (
            db.query(VoiceProfile)
            .filter(VoiceProfile.qwen_voice_id == request.voice_id)
            .first()
        )
        voice_name = voice.name if voice else request.voice_id

        if is_frontend_storage(db):
            # 前端模式：读取音频返回 base64，不持久化
            with open(audio_path, "rb") as f:
                audio_base64 = base64.b64encode(f.read()).decode("utf-8")
            os.remove(audio_path)  # 清理临时文件
            return {
                "audio_id": audio_id,
                "audio_base64": audio_base64,
                "audio_format": audio_fmt,
                "text": request.text,
                "voice_id": request.voice_id,
                "voice_name": voice_name,
                "params": {
                    "speed": request.speed,
                    "volume": request.volume,
                    "pitch": request.pitch,
                    "emotion": request.emotion,
                    "voice_id": request.voice_id,
                }
            }
        else:
            # 后端模式：保持现状
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
```

**Step 2: 同样修改 `_synthesize_edge_tts`**

在 `_synthesize_edge_tts` 函数（约 L150-L200）的音档写入后增加分支：

```python
# ... 现有代码到 audio_data 写入后 ...

        if is_frontend_storage(db):
            # 前端模式：返回 base64，不持久化
            audio_base64 = base64.b64encode(audio_data).decode("utf-8")
            if os.path.exists(str(audio_path)):
                os.remove(str(audio_path))
            return {
                "audio_id": audio_id,
                "audio_base64": audio_base64,
                "audio_format": "mp3",
                "text": request.text,
                "voice_id": request.edge_voice,
                "voice_name": request.edge_voice,
                "params": {
                    "engine": "edge_tts",
                    "edge_voice": request.edge_voice,
                    "edge_rate": request.edge_rate,
                    "edge_volume": request.edge_volume,
                }
            }
        else:
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
```

**Step 3: 验证**

重启后端后测试：
```bash
# 确保后端模式正常工作（不传 storage_mode 相关的修改即可）
curl -X PUT http://127.0.0.1:8002/api/config/storage-mode -H "Content-Type: application/json" -d '{"storage_mode":"backend"}'
# 正常合成一次，验证 audio_url 仍返回
curl -X PUT http://127.0.0.1:8002/api/config/storage-mode -H "Content-Type: application/json" -d '{"storage_mode":"frontend"}'
# 合成一次，验证返回 audio_base64 字段
```

**Step 4: Commit**

```bash
git add backend/app/api/tts.py
git commit -m "feat: adapt TTS synthesize for frontend storage mode (base64 return)"
```

---

### Task 4: 后端 - STT 转写接口适配双模式

**Files:**
- Modify: `backend/app/api/speech_to_text.py`

**Step 1: 在 speech_to_text.py 添加 import 并修改 transcribe 端点**

在 [speech_to_text.py](file:///e:/repos/vcprjs/voice_clone/backend/app/api/speech_to_text.py) 顶部添加：

```python
from app.core.system_config_service import is_frontend_storage
```

修改 `transcribe` 函数（约 L70-L140），将原来「落盘+写库」逻辑改为分支：

```python
    try:
        service = VoiceToSrt()
        result = service.voicetosrt(
            input_file=tmp_path,
            file_id=file_id,
            model_size=model_size,
            beam_size=beam_size,
        )

        if is_frontend_storage(db):
            # 前端模式：不持久化，直接返回结果
            pass  # 跳过持久化
        else:
            # 后端模式：保持现状，持久化音频和记录
            audio_dest = str(settings.srt_output_dir / f"{file_id}_original.{file_ext}")
            shutil.copy2(tmp_path, audio_dest)
            record = TranscriptionRecord(
                original_filename=file.filename,
                audio_path=audio_dest,
                srt_file_id=file_id,
                language=result.language,
                language_probability=result.language_probability,
                model_size=model_size,
            )
            db.add(record)
            db.commit()
            _enforce_history_limit("default_user", db)

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Transcription failed: {str(e)}")
    finally:
        os.unlink(tmp_path)

    return {
        "file_id": file_id,
        "filename": result.filename,
        "content": result.content,
        "language": result.language,
        "language_probability": result.language_probability,
        "download_url": f"/api/speech-to-text/download/{file_id}" if not is_frontend_storage(db) else None,
    }
```

**Step 2: 验证**

```bash
curl http://127.0.0.1:8002/api/config/storage-mode
# 确保当前模式为 backend 或 frontend，分别测试一次转写
```

**Step 3: Commit**

```bash
git add backend/app/api/speech_to_text.py
git commit -m "feat: adapt STT transcribe for frontend storage mode (skip persistence)"
```

---

### Task 5: 前端 - IndexedDB 存储层

**Files:**
- Create: `frontend/src/services/indexedDB.ts`
- Modify: `frontend/src/types/index.ts`

**Step 1: 新增类型定义**

在 [types/index.ts](file:///e:/repos/vcprjs/voice_clone/frontend/src/types/index.ts) 末尾追加：

```typescript
// 前端 IndexedDB 本地存储的 TTS 记录（含 Blob）
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
  emotion: string;
  language: string;
  created_at: string;
}

// 前端 IndexedDB 本地存储的 STT 记录
export interface STTLocalRecord {
  id: string;
  original_filename: string;
  srtContent: string;
  language: string;
  language_probability: number;
  model_size: string;
  created_at: string;
}
```

**Step 2: 创建 indexedDB.ts**

```typescript
// frontend/src/services/indexedDB.ts
import type { TTSLocalRecord, STTLocalRecord, TTSResultRecord } from '../types';

const DB_NAME = 'voice_clone_studio';
const DB_VERSION = 1;
const TTS_STORE = 'tts_results';
const STT_STORE = 'stt_results';

// ---------------------------------------------------------------------------
// 数据库初始化
// ---------------------------------------------------------------------------
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(TTS_STORE)) {
        db.createObjectStore(TTS_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STT_STORE)) {
        db.createObjectStore(STT_STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function storePut(db: IDBDatabase, storeName: string, value: any): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function storeGetAll<T>(db: IDBDatabase, storeName: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const request = tx.objectStore(storeName).getAll();
    request.onsuccess = () => resolve(request.result as T[]);
    request.onerror = () => reject(request.error);
  });
}

function storeGet<T>(db: IDBDatabase, storeName: string, key: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const request = tx.objectStore(storeName).get(key);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => reject(request.error);
  });
}

function storeDelete(db: IDBDatabase, storeName: string, key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ---------------------------------------------------------------------------
// TTS 结果管理
// ---------------------------------------------------------------------------
export async function saveTTSResult(record: TTSLocalRecord): Promise<void> {
  const db = await openDB();
  await storePut(db, TTS_STORE, record);
}

export async function getTTSHistory(): Promise<TTSLocalRecord[]> {
  const db = await openDB();
  const results = await storeGetAll<TTSLocalRecord>(db, TTS_STORE);
  // 按时间倒序
  return results.sort((a, b) =>
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
}

export async function deleteTTSResult(id: string): Promise<void> {
  const db = await openDB();
  await storeDelete(db, TTS_STORE, id);
}

export async function getTTSAudioBlob(id: string): Promise<Blob | null> {
  const db = await openDB();
  const record = await storeGet<TTSLocalRecord>(db, TTS_STORE, id);
  return record?.audioBlob ?? null;
}

// ---------------------------------------------------------------------------
// STT 结果管理
// ---------------------------------------------------------------------------
export async function saveSTTResult(record: STTLocalRecord): Promise<void> {
  const db = await openDB();
  await storePut(db, STT_STORE, record);
}

export async function getSTTHistory(): Promise<STTLocalRecord[]> {
  const db = await openDB();
  const results = await storeGetAll<STTLocalRecord>(db, STT_STORE);
  return results.sort((a, b) =>
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
}

export async function deleteSTTResult(id: string): Promise<void> {
  const db = await openDB();
  await storeDelete(db, STT_STORE, id);
}
```

**Step 3: Commit**

```bash
git add frontend/src/services/indexedDB.ts frontend/src/types/index.ts
git commit -m "feat: add IndexedDB storage layer for frontend mode"
```

---

### Task 6: 前端 - 存储模式 Context + 设置面板

**Files:**
- Create: `frontend/src/hooks/useStorageMode.ts`
- Modify: `frontend/src/services/api.ts`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/App.module.css`

**Step 1: api.ts 新增存储模式 API**

在 [api.ts](file:///e:/repos/vcprjs/voice_clone/frontend/src/services/api.ts) 的 `configApi` 对象中新增方法：

```typescript
// 在 configApi 对象内追加：
  getStorageMode: async (): Promise<{ storage_mode: string }> => {
    const { data } = await api.get<{ storage_mode: string }>('/config/storage-mode');
    return data;
  },

  setStorageMode: async (mode: string): Promise<{ storage_mode: string }> => {
    const { data } = await api.put<{ storage_mode: string }>('/config/storage-mode', { storage_mode: mode });
    return data;
  },
```

**Step 2: 创建 useStorageMode hook**

```typescript
// frontend/src/hooks/useStorageMode.ts
import { createContext, useContext } from 'react';

export type StorageMode = 'backend' | 'frontend';

export const StorageModeContext = createContext<{
  mode: StorageMode;
  setMode: (mode: StorageMode) => void;
}>({
  mode: 'backend',
  setMode: () => {},
});

/** 获取当前存储模式 */
export function useStorageMode() {
  return useContext(StorageModeContext);
}
```

**Step 3: 创建 hooks 目录（如不存在）并确保存在**

```bash
mkdir -p frontend/src/hooks
```

**Step 4: 修改 App.tsx**

修改 [App.tsx](file:///e:/repos/vcprjs/voice_clone/frontend/src/App.tsx)：

- 添加 storage mode state 和初始化逻辑
- 用 `StorageModeContext.Provider` 包裹
- 添加齿轮图标设置按钮

```tsx
import { useState, useEffect } from 'react';
import { VoiceClone } from './pages/VoiceClone';
import { TTSSynthesis } from './pages/TTSSynthesis';
import { SpeechToText } from './pages/SpeechToText';
import { configApi } from './services/api';
import { StorageModeContext, type StorageMode } from './hooks/useStorageMode';
import styles from './App.module.css';

type Tab = 'voice-clone' | 'tts-synthesis' | 'speech-to-text';

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('voice-clone');
  const [storageMode, setStorageMode] = useState<StorageMode>('backend');
  const [showSettings, setShowSettings] = useState(false);

  // 启动时从后端加载存储模式
  useEffect(() => {
    configApi.getStorageMode().then(
      (data) => setStorageMode(data.storage_mode as StorageMode),
      () => console.warn('Failed to load storage mode, using default backend')
    );
  }, []);

  const handleSetStorageMode = async (mode: StorageMode) => {
    try {
      await configApi.setStorageMode(mode);
      setStorageMode(mode);
    } catch {
      console.error('Failed to save storage mode');
    }
  };

  return (
    <StorageModeContext.Provider value={{ mode: storageMode, setMode: handleSetStorageMode }}>
      <div className={styles.app}>
        <header className={styles.header}>
          <div className={styles.logo}>
            <span>🎙️</span>
            <span>Voice Clone Studio</span>
          </div>

          <nav className={styles.tabs}>
            <button
              data-testid="tab-voice-clone"
              className={`${styles.tab} ${activeTab === 'voice-clone' ? styles.active : ''}`}
              onClick={() => setActiveTab('voice-clone')}
            >
              声音克隆
            </button>
            <button
              data-testid="tab-tts-synthesis"
              className={`${styles.tab} ${activeTab === 'tts-synthesis' ? styles.active : ''}`}
              onClick={() => setActiveTab('tts-synthesis')}
            >
              文字转语音
            </button>
            <button
              data-testid="tab-speech-to-text"
              className={`${styles.tab} ${activeTab === 'speech-to-text' ? styles.active : ''}`}
              onClick={() => setActiveTab('speech-to-text')}
            >
              语音转字幕
            </button>
          </nav>

          <div className={styles.settingsArea}>
            <button
              className={styles.settingsButton}
              onClick={() => setShowSettings(!showSettings)}
              title="设置"
            >
              ⚙️
            </button>
            {showSettings && (
              <div className={styles.settingsPanel}>
                <div className={styles.settingsItem}>
                  <label>存储模式</label>
                  <select
                    value={storageMode}
                    onChange={(e) => handleSetStorageMode(e.target.value as StorageMode)}
                  >
                    <option value="backend">后端存储</option>
                    <option value="frontend">浏览器存储</option>
                  </select>
                </div>
              </div>
            )}
          </div>
        </header>

        <main className={styles.main}>
          <div style={{ display: activeTab === 'voice-clone' ? 'block' : 'none' }}>
            <VoiceClone />
          </div>
          <div style={{ display: activeTab === 'tts-synthesis' ? 'block' : 'none' }}>
            <TTSSynthesis />
          </div>
          <div style={{ display: activeTab === 'speech-to-text' ? 'block' : 'none' }}>
            <SpeechToText />
          </div>
        </main>
      </div>
    </StorageModeContext.Provider>
  );
}
```

**Step 5: App.module.css 新增设置区域样式**

在 [App.module.css](file:///e:/repos/vcprjs/voice_clone/frontend/src/App.module.css) 末尾追加：

```css
/* Settings Area */
.settingsArea {
  position: relative;
}

.settingsButton {
  background: rgba(255, 255, 255, 0.08);
  border: none;
  color: rgba(255, 255, 255, 0.8);
  width: 36px;
  height: 36px;
  border-radius: var(--radius-full);
  cursor: pointer;
  font-size: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background var(--transition-normal);
}

.settingsButton:hover {
  background: rgba(255, 255, 255, 0.15);
}

.settingsPanel {
  position: absolute;
  right: 0;
  top: 44px;
  background: #1a1a1a;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: var(--radius-lg);
  padding: var(--spacing-md);
  min-width: 220px;
  z-index: 100;
}

.settingsItem {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
}

.settingsItem label {
  font-size: var(--font-size-sm);
  color: rgba(255, 255, 255, 0.6);
}

.settingsItem select {
  padding: var(--spacing-xs) var(--spacing-sm);
  border-radius: var(--radius-md);
  border: 1px solid rgba(255, 255, 255, 0.15);
  background: rgba(255, 255, 255, 0.06);
  color: white;
  font-size: var(--font-size-sm);
}
```

**Step 6: 验证前端编译**

```bash
cd frontend && npm run build
```

**Step 7: Commit**

```bash
git add frontend/src/hooks/useStorageMode.ts frontend/src/services/api.ts frontend/src/App.tsx frontend/src/App.module.css
git commit -m "feat: add storage mode context, settings panel, and CSS-based tab switching"
```

---

### Task 7: 前端 - TTS 页面适配前端存储模式

**Files:**
- Modify: `frontend/src/pages/TTSSynthesis.tsx`
- Modify: `frontend/src/components/TTSSynthesis/SynthesisHistory.tsx`

**Step 1: 修改 TTSSynthesis.tsx 合成逻辑**

在 [TTSSynthesis.tsx](file:///e:/repos/vcprjs/voice_clone/frontend/src/pages/TTSSynthesis.tsx) 中：

1. 引入 `useStorageMode` hook
2. 引入 `indexedDB` 方法
3. 修改 `handleSynthesize` 中的合成返回处理，根据模式选择存储路径
4. 修改 `loadHistory` 和 `handleDeleteResult`

关键改动（在 `handleSynthesize` 的返回处理中）：

```tsx
import { useStorageMode } from '../hooks/useStorageMode';
import { saveTTSResult, getTTSHistory, deleteTTSResult } from '../services/indexedDB';
import type { TTSLocalRecord } from '../types';

// 在组件内：
const { mode: storageMode } = useStorageMode();

// 修改 loadHistory：
const loadHistory = useCallback(async () => {
  try {
    if (storageMode === 'frontend') {
      const local = await getTTSHistory();
      // 转换 TTSLocalRecord 为 TTSResultRecord 格式（不含 Blob，用于展示）
      setHistory(local.map(r => ({
        id: r.id,
        text: r.text,
        voice_id: r.voice_id,
        voice_name: r.voice_name,
        audio_url: URL.createObjectURL(r.audioBlob),
        audio_format: r.audio_format,
        speed: r.speed,
        volume: r.volume,
        pitch: r.pitch,
        emotion: r.emotion,
        language: r.language,
        created_at: r.created_at,
      })));
    } else {
      const data = await ttsApi.getHistory();
      setHistory(data);
    }
  } catch (error) {
    console.error('Failed to load history:', error);
  }
}, [storageMode]);

// 修改 handleDeleteResult：
const handleDeleteResult = useCallback(async (id: string) => {
  try {
    if (storageMode === 'frontend') {
      await deleteTTSResult(id);
    } else {
      await ttsApi.deleteResult(id);
    }
    setHistory(prev => prev.filter(r => r.id !== id));
  } catch (error) {
    console.error('Failed to delete result:', error);
    alert('删除失败');
  }
}, [storageMode]);

// 修改 handleSynthesize 中的成功处理（在 setResult 和 loadHistory 之间）：
// 如果 response 中有 audio_base64，保存到 IndexedDB
if (storageMode === 'frontend' && 'audio_base64' in response) {
  const { audio_base64, audio_format, voice_id, voice_name } = response as any;
  const byteChars = atob(audio_base64);
  const byteNums = new Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) {
    byteNums[i] = byteChars.charCodeAt(i);
  }
  const audioBlob = new Blob([new Uint8Array(byteNums)], { type: `audio/${audio_format}` });
  await saveTTSResult({
    id: response.audio_id,
    text: text,
    voice_id: voice_id || selectedVoiceId,
    voice_name: voice_name || '',
    audioBlob,
    audio_format: audio_format || 'mp3',
    speed: params.speed ?? 1.0,
    volume: params.volume ?? 80,
    pitch: params.pitch ?? 0,
    emotion: params.emotion || 'neutral',
    language: params.language || 'Chinese',
    created_at: new Date().toISOString(),
  });
  setResult({
    audio_id: response.audio_id,
    audio_url: URL.createObjectURL(audioBlob),
    text: text,
    params: {
      voice_id: response.voice_id || selectedVoiceId,
      speed: params.speed ?? 1.0,
      volume: params.volume ?? 80,
      pitch: params.pitch ?? 0,
      language: params.language || 'Chinese',
      emotion: params.emotion || 'neutral',
    },
  });
}
```

**Step 2: 同样修改 handlePlayResult**

确保 `handlePlayResult` 在前端模式下使用 `URL.createObjectURL` 生成的 URL。

**Step 3: 验证**

```bash
cd frontend && npm run build
```

**Step 4: Commit**

```bash
git add frontend/src/pages/TTSSynthesis.tsx
git commit -m "feat: adapt TTS page for dual storage mode (IndexedDB vs backend)"
```

---

### Task 8: 前端 - STT 页面适配前端存储模式

**Files:**
- Modify: `frontend/src/pages/SpeechToText.tsx`

**Step 1: 修改 SpeechToText.tsx**

在 [SpeechToText.tsx](file:///e:/repos/vcprjs/voice_clone/frontend/src/pages/SpeechToText.tsx) 中：

引入 `useStorageMode` 和 IndexedDB 方法，修改 `loadHistory`、`handleDeleteRecord`、`handleTranscribe` 的成功处理。

关键改动类似于 Task 7，在前端模式下：
- 转写成功后调用 `saveSTTResult` 保存到 IndexedDB
- 历史从 IndexedDB 读取
- 删除调用 `deleteSTTResult`

```tsx
import { useStorageMode } from '../hooks/useStorageMode';
import { saveSTTResult, getSTTHistory, deleteSTTResult } from '../services/indexedDB';
import type { STTLocalRecord } from '../types';

// loadHistory:
const loadHistory = useCallback(async () => {
  try {
    if (storageMode === 'frontend') {
      const local = await getSTTHistory();
      setHistory(local.map(r => ({
        id: r.id,
        original_filename: r.original_filename,
        audio_url: '',
        srt_download_url: '',
        language: r.language,
        language_probability: r.language_probability,
        model_size: r.model_size,
        created_at: r.created_at,
      })));
    } else {
      const data = await speechToTextApi.getHistory();
      setHistory(data);
    }
  } catch (error) {
    console.error('Failed to load history:', error);
  }
}, [storageMode]);

// handleDeleteRecord:
const handleDeleteRecord = useCallback(async (id: string) => {
  try {
    if (storageMode === 'frontend') {
      await deleteSTTResult(id);
    } else {
      await speechToTextApi.deleteRecord(id);
    }
    setHistory(prev => prev.filter(r => r.id !== id));
  } catch (error) {
    console.error('Failed to delete record:', error);
  }
}, [storageMode]);

// handleTranscribe 成功处理中新增：
if (storageMode === 'frontend') {
  await saveSTTResult({
    id: res.file_id,
    original_filename: file.name,
    srtContent: res.content,
    language: res.language,
    language_probability: res.language_probability,
    model_size: modelSize,
    created_at: new Date().toISOString(),
  });
}
```

**Step 2: 验证**

```bash
cd frontend && npm run build
```

**Step 3: Commit**

```bash
git add frontend/src/pages/SpeechToText.tsx
git commit -m "feat: adapt STT page for dual storage mode"
```

---

### Task 9: 后端 - ffmpeg 合并 + 多音频转写 API

**Files:**
- Create: `backend/app/services/audio_merge_service.py`
- Modify: `backend/app/core/config.py`
- Modify: `backend/app/api/speech_to_text.py`

**Step 1: config.py 增加 ffmpeg_path 配置**

在 [config.py](file:///e:/repos/vcprjs/voice_clone/backend/app/core/config.py) 的 `Settings` 类中增加：

```python
# ffmpeg 路径，默认为系统 PATH 中的 ffmpeg
ffmpeg_path: str = "ffmpeg"
```

**Step 2: 创建 audio_merge_service.py**

```python
# backend/app/services/audio_merge_service.py
import subprocess
import tempfile
import os
from pathlib import Path
import logging

from app.core.config import settings

logger = logging.getLogger(__name__)


def merge_audio_files(
    audio_paths: list[str],
    output_path: str | None = None,
    silence_seconds: float = 0.5,
) -> str:
    """使用 ffmpeg 按顺序拼接多个音频文件，每段之间插入静音间隔。

    返回合并后的文件路径。
    如果未指定 output_path，则使用临时文件。
    """
    if not audio_paths:
        raise ValueError("audio_paths must not be empty")

    if len(audio_paths) == 1:
        # 单文件直接返回路径
        return audio_paths[0]

    if output_path is None:
        tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
        output_path = tmp.name
        tmp.close()

    # 构建 ffmpeg concat filter 命令
    # 思路：每个输入文件后追加 aevalsrc 生成的静音
    inputs = []
    filter_parts = []
    for i, path in enumerate(audio_paths):
        inputs.extend(["-i", path])
        # 每个文件段：[i:a] + 静音 -> [a_seg{i}]
        filter_parts.append(f"[{i}:a]atrim=0,asetpts=PTS-STARTPTS[a_seg{i}]")

    # 为每个段之间生成静音 (除了最后一段之后)
    silence_filters = []
    concat_inputs = []
    for i in range(len(audio_paths)):
        concat_inputs.append(f"[a_seg{i}]")
        if i < len(audio_paths) - 1:
            silence_label = f"silence_{i}"
            silence_filters.append(
                f"aevalsrc=0:duration={silence_seconds}:sample_rate=16000[{silence_label}]"
            )
            concat_inputs.append(f"[{silence_label}]")

    filter_complex = ";".join(filter_parts + silence_filters)
    filter_complex += f";{''.join(concat_inputs)}concat=n={len(concat_inputs)}:v=0:a=1[out]"

    cmd = [
        settings.ffmpeg_path,
        *inputs,
        "-filter_complex", filter_complex,
        "-map", "[out]",
        "-y",
        output_path,
    ]

    logger.info(f"Merging {len(audio_paths)} audio files with ffmpeg: {cmd}")

    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        logger.error(f"ffmpeg merge failed: {result.stderr}")
        raise RuntimeError(f"ffmpeg merge failed: {result.stderr}")

    return output_path
```

**Step 3: speech_to_text.py 新增 merge-transcribe 端点**

在 [speech_to_text.py](file:///e:/repos/vcprjs/voice_clone/backend/app/api/speech_to_text.py) 末尾追加：

```python
from pydantic import BaseModel
from typing import List
from app.services.audio_merge_service import merge_audio_files
from app.core.system_config_service import is_frontend_storage


class MergeTranscribeRequest(BaseModel):
    audio_ids: List[str] = []          # 有序 ID 列表，后端模式使用
    audio_order: List[int] | None = None  # 上传时的排序索引，前端模式使用
    model_size: str = "large-v3"
    beam_size: int = 5
    silence_seconds: float = 0.5


@router.post("/merge-transcribe")
async def merge_and_transcribe(
    request: MergeTranscribeRequest,
    db: Session = Depends(get_db),
):
    """合并多个 TTS 合成音频并转字幕（后端存储模式）"""
    if not request.audio_ids:
        raise HTTPException(status_code=400, detail="audio_ids is required")

    # 根据 ID 查找音频文件路径
    from app.models.tts_result import TTSResultRecord
    audio_paths = []
    for aid in request.audio_ids:
        record = db.query(TTSResultRecord).filter(TTSResultRecord.id == aid).first()
        if not record or not os.path.exists(record.audio_path):
            raise HTTPException(status_code=404, detail=f"Audio not found: {aid}")
        audio_paths.append(record.audio_path)

    # ffmpeg 合并
    merged_path = merge_audio_files(audio_paths, silence_seconds=request.silence_seconds)

    try:
        file_id = str(uuid.uuid4())
        service = VoiceToSrt()
        result = service.voicetosrt(
            input_file=merged_path,
            file_id=file_id,
            model_size=request.model_size,
            beam_size=request.beam_size,
        )
    finally:
        # 清理合并后的临时文件
        if len(request.audio_ids) > 1 and os.path.exists(merged_path):
            os.remove(merged_path)

    if not is_frontend_storage(db):
        # 后端模式：持久化合并音频和记录
        audio_dest = str(settings.srt_output_dir / f"{file_id}_merged.wav")
        shutil.copy2(merged_path, audio_dest) if os.path.exists(merged_path) else None

        record = TranscriptionRecord(
            original_filename=f"merged_{len(request.audio_ids)}_files",
            audio_path=audio_dest,
            srt_file_id=file_id,
            language=result.language,
            language_probability=result.language_probability,
            model_size=request.model_size,
        )
        db.add(record)
        db.commit()
        _enforce_history_limit("default_user", db)

    return {
        "file_id": file_id,
        "filename": result.filename,
        "content": result.content,
        "language": result.language,
        "language_probability": result.language_probability,
    }


@router.post("/merge-transcribe-upload")
async def merge_and_transcribe_upload(
    files: List[UploadFile] = File(...),
    order: str = Form(""),  # 逗号分隔的排序索引，如 "0,2,1"
    model_size: str = Form("large-v3"),
    beam_size: int = Form(5),
    silence_seconds: float = Form(0.5),
    db: Session = Depends(get_db),
):
    """前端存储模式：上传多个音频，合并并转字幕"""
    if not files:
        raise HTTPException(status_code=400, detail="No files uploaded")

    # 按 order 排序
    order_indices = [int(x.strip()) for x in order.split(",") if x.strip()] if order else list(range(len(files)))
    sorted_files = [files[i] for i in order_indices if i < len(files)]

    # 临时保存上传的文件
    tmp_paths = []
    try:
        for f in sorted_files:
            ext = f.filename.split(".")[-1] if "." in (f.filename or "") else "mp3"
            tmp = tempfile.NamedTemporaryFile(suffix=f".{ext}", delete=False)
            content = await f.read()
            tmp.write(content)
            tmp.close()
            tmp_paths.append(tmp.name)

        # ffmpeg 合并
        merged_path = merge_audio_files(tmp_paths, silence_seconds=silence_seconds)

        file_id = str(uuid.uuid4())
        service = VoiceToSrt()
        result = service.voicetosrt(
            input_file=merged_path,
            file_id=file_id,
            model_size=model_size,
            beam_size=beam_size,
        )

    finally:
        for p in tmp_paths:
            if os.path.exists(p):
                os.remove(p)
        if 'merged_path' in dir() and os.path.exists(merged_path):
            os.remove(merged_path)

    return {
        "file_id": file_id,
        "filename": result.filename,
        "content": result.content,
        "language": result.language,
        "language_probability": result.language_probability,
    }
```

**Step 4: 验证 ffmpeg 可用**

```bash
ffmpeg -version
```

**Step 5: Commit**

```bash
git add backend/app/services/audio_merge_service.py backend/app/core/config.py backend/app/api/speech_to_text.py
git commit -m "feat: add ffmpeg audio merge and multi-file STT API"
```

---

### Task 10: 前端 - 多音频选择 + 排序 + 合并识别 UI

**Files:**
- Modify: `frontend/src/pages/SpeechToText.tsx`
- Modify: `frontend/src/pages/SpeechToText.module.css`
- Modify: `frontend/src/services/api.ts`

**Step 1: api.ts 新增合并转写 API**

在 `speechToTextApi` 对象末尾追加：

```typescript
  mergeTranscribe: async (audioIds: string[], modelSize: string, beamSize: number, silenceSeconds: number): Promise<TranscribeResult> => {
    const { data } = await api.post<TranscribeResult>('/speech-to-text/merge-transcribe', {
      audio_ids: audioIds,
      model_size: modelSize,
      beam_size: beamSize,
      silence_seconds: silenceSeconds,
    });
    return data;
  },

  mergeTranscribeUpload: async (files: File[], order: number[], modelSize: string, beamSize: number, silenceSeconds: number): Promise<TranscribeResult> => {
    const formData = new FormData();
    files.forEach(f => formData.append('files', f));
    formData.append('order', order.join(','));
    formData.append('model_size', modelSize);
    formData.append('beam_size', String(beamSize));
    formData.append('silence_seconds', String(silenceSeconds));
    const { data } = await api.post<TranscribeResult>('/speech-to-text/merge-transcribe-upload', formData);
    return data;
  },
```

**Step 2: SpeechToText.tsx 新增「从合成历史选择」UI**

在 [SpeechToText.tsx](file:///e:/repos/vcprjs/voice_clone/frontend/src/pages/SpeechToText.tsx) 中：

1. 新增 `inputMode` state：`'upload' | 'history'`
2. 新增 `selectedAudioIds` state 用于多选
3. 新增 `orderedIds` state 用于排序结果
4. 在内容区顶部增加模式切换 Tab（上传 / 从历史选择）
5. 历史选择模式下展示合成历史列表（调用 `ttsApi.getHistory` 或 IndexedDB）
6. 选中项添加拖拽排序功能
7. 「合并并识别」按钮调用相应的 API

由于代码较长，关键结构如下：

```tsx
const [inputMode, setInputMode] = useState<'upload' | 'history'>('upload');
const [selectedAudioIds, setSelectedAudioIds] = useState<string[]>([]); // 保持选择顺序
const [ttsHistory, setTtsHistory] = useState<TTSResultRecord[]>([]);

// 加载 TTS 历史（用于列表选择）
const loadTtsHistory = useCallback(async () => {
  // 根据 storageMode 决定数据源
}, [storageMode]);

// 切换选择
const toggleSelect = (id: string) => {
  setSelectedAudioIds(prev =>
    prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
  );
};

// 上移/下移排序
const moveUp = (id: string) => { /* ... */ };
const moveDown = (id: string) => { /* ... */ };

// 合并并识别
const handleMergeTranscribe = async () => {
  if (selectedAudioIds.length === 0) return;
  setProcessing(true);
  try {
    let res: TranscribeResult;
    if (storageMode === 'frontend') {
      // 从 IndexedDB 取出 Blob 再上传
      const files: File[] = [];
      for (const id of selectedAudioIds) {
        const blob = await getTTSAudioBlob(id);
        if (blob) {
          files.push(new File([blob], `${id}.mp3`, { type: 'audio/mpeg' }));
        }
      }
      res = await speechToTextApi.mergeTranscribeUpload(files, [...Array(files.length).keys()], modelSize, beamSize, 0.5);
    } else {
      res = await speechToTextApi.mergeTranscribe(selectedAudioIds, modelSize, beamSize, 0.5);
    }
    setResult(res);
    loadHistory();
  } catch (err) {
    // ...
  } finally {
    setProcessing(false);
  }
};
```

**Step 3: SpeechToText.module.css 新增样式**

历史选择列表、排序按钮、合并按钮的样式。

**Step 4: 验证**

```bash
cd frontend && npm run build
```

**Step 5: Commit**

```bash
git add frontend/src/pages/SpeechToText.tsx frontend/src/pages/SpeechToText.module.css frontend/src/services/api.ts
git commit -m "feat: add multi-audio selection and merge-transcribe UI in STT page"
```

---

### 最终验证

全部完成后进行端到端测试：

1. **存储模式切换**：在设置面板切换 => 验证后端 API 返回对应模式
2. **后端模式 TTS**：合成语音 → 刷新页面 → 历史仍存在
3. **前端模式 TTS**：切换模式 → 合成语音 → 刷新页面 → 历史仍存在（在 IndexedDB 中）
4. **Tab 切换**：在 TTS 页合成 → 切到 STT 页 → 切回 TTS → 内容保留
5. **多音频合并**：合成 3 段语音 → 进入 STT 页历史选择模式 → 选 3 个文件 → 排序 → 合并识别 → 获得 SRT