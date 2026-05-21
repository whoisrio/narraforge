# Speech-to-Text Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a speech-to-text feature that uploads audio, transcribes it with Whisper, previews the SRT inline, and provides a download link.

**Architecture:** Minimal API approach — single POST endpoint for transcription, single GET endpoint for file download. Refactor the existing `VoiceToSrt` service to return content alongside the file path. New standalone frontend page with upload, params, preview, and download.

**Tech Stack:** FastAPI, faster-whisper, React, TypeScript, CSS Modules

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `backend/app/api/speech_to_text.py` | API routes for transcription and download |
| Modify | `backend/app/services/voice_to_srt_service.py` | Refactor to return SRT content + path |
| Modify | `backend/main.py` | Register new router |
| Modify | `backend/app/core/config.py` | Add `srt_output_dir` setting |
| Create | `backend/tests/test_api_speech_to_text.py` | API tests for new endpoints |
| Modify | `backend/tests/conftest.py` | Add mock fixture for VoiceToSrt service |
| Create | `frontend/src/pages/SpeechToText.tsx` | New speech-to-text page |
| Create | `frontend/src/pages/SpeechToText.module.css` | Page styles |
| Modify | `frontend/src/services/api.ts` | Add speechToTextApi |
| Modify | `frontend/src/App.tsx` | Add navigation tab |
| Modify | `frontend/src/App.module.css` | (no changes needed — tabs already styled) |

---

### Task 1: Add `srt_output_dir` to backend config

**Files:**
- Modify: `backend/app/core/config.py`

- [ ] **Step 1: Add the setting**

In `backend/app/core/config.py`, add after the `videos_dir` line:

```python
    srt_output_dir: Path = uploads_dir / "srt"
```

- [ ] **Step 2: Verify the setting loads**

Run: `cd /Users/rio/repos/myprjs/voiceclone/backend && python -c "from app.core.config import settings; print(settings.srt_output_dir)"`
Expected: prints path ending in `uploads/srt`

- [ ] **Step 3: Commit**

```bash
git add backend/app/core/config.py
git commit -m "feat: add srt_output_dir to backend config"
```

---

### Task 2: Refactor VoiceToSrt service to return content

**Files:**
- Modify: `backend/app/services/voice_to_srt_service.py`

- [ ] **Step 1: Write the test for the refactored return value**

Create a simple test at the bottom of the service file or in a test — but since this is a service refactor, we'll verify via the API test in Task 4. Instead, refactor now and verify manually.

- [ ] **Step 2: Refactor `voicetosrt()` to return a dataclass with content and path**

Replace the entire content of `backend/app/services/voice_to_srt_service.py` with:

```python
import os
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

os.environ['KMP_DUPLICATE_LIB_OK'] = 'True'


@dataclass
class SrtResult:
    file_path: Path
    content: str
    filename: str
    language: str
    language_probability: float


class VoiceToSrt:
    def _resolve_output_dir(self, output_path: str | None = None) -> Path:
        if output_path:
            p = Path(output_path)
        elif os.getenv('OUTPUT_DIR'):
            p = Path(os.getenv('OUTPUT_DIR'))
        else:
            p = Path(__file__).parent.parent.parent / 'output' / 'srt'
        p.mkdir(parents=True, exist_ok=True)
        return p

    def _resolve_output_filename(self, input_file: str, file_id: str, output_filename: str | None = None) -> str:
        if output_filename:
            name = output_filename if output_filename.endswith('.srt') else output_filename + '.srt'
            return f'{file_id}_{name}'
        stem = Path(input_file).stem
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        return f'{file_id}_{stem}_{timestamp}.srt'

    def _format_srt_time(self, seconds: float) -> str:
        h = int(seconds // 3600)
        m = int((seconds % 3600) // 60)
        s = int(seconds % 60)
        ms = int(round((seconds - int(seconds)) * 1000))
        return f'{h:02d}:{m:02d}:{s:02d},{ms:03d}'

    def voicetosrt(
        self,
        input_file: str,
        file_id: str,
        output_filename: str | None = None,
        output_path: str | None = None,
        model_size: str = 'large-v3',
        device: str = 'cpu',
        compute_type: str = 'int8',
        beam_size: int = 5,
    ) -> SrtResult:
        from faster_whisper import WhisperModel
        from dotenv import load_dotenv
        load_dotenv()

        model = WhisperModel(model_size, device=device, compute_type=compute_type)
        segments, info = model.transcribe(input_file, beam_size=beam_size)

        # Build SRT content in memory
        lines = []
        for i, seg in enumerate(segments, start=1):
            lines.append(str(i))
            lines.append(f'{self._format_srt_time(seg.start)} --> {self._format_srt_time(seg.end)}')
            lines.append(seg.text.strip())
            lines.append('')

        content = '\n'.join(lines)

        out_dir = self._resolve_output_dir(output_path)
        filename = self._resolve_output_filename(input_file, file_id, output_filename)
        out_file = out_dir / filename

        with open(out_file, 'w', encoding='utf-8') as f:
            f.write(content)

        return SrtResult(
            file_path=out_file,
            content=content,
            filename=filename,
            language=info.language,
            language_probability=info.language_probability,
        )


if __name__ == '__main__':
    import argparse

    parser = argparse.ArgumentParser(description='语音文件转 SRT 字幕')
    parser.add_argument('input_file', help='输入语音文件路径')
    parser.add_argument('-o', '--output-filename', default=None, help='输出文件名（默认: 原文件名_日期_时分秒.srt）')
    parser.add_argument('-p', '--output-path', default=None, help='输出目录（默认: .env OUTPUT_PATH 或脚本目录/output）')
    parser.add_argument('-m', '--model-size', default='large-v3', help='模型大小（默认: large-v3）')
    parser.add_argument('-d', '--device', default='cpu', help='推理设备（默认: cpu）')
    parser.add_argument('-c', '--compute-type', default='int8', help='计算精度（默认: int8）')
    parser.add_argument('-b', '--beam-size', type=int, default=5, help='beam search 大小（默认: 5）')

    args = parser.parse_args()
    import uuid
    vtosrt = VoiceToSrt()
    result = vtosrt.voicetosrt(
        input_file=args.input_file,
        file_id=str(uuid.uuid4()),
        output_filename=args.output_filename,
        output_path=args.output_path,
        model_size=args.model_size,
        device=args.device,
        compute_type=args.compute_type,
        beam_size=args.beam_size,
    )
    print(f'SRT saved: {result.file_path}')
    print(f'Language: {result.language} ({result.language_probability:.4f})')
```

Key changes:
- New `SrtResult` dataclass with `file_path`, `content`, `filename`, `language`, `language_probability`
- `voicetosrt()` now requires `file_id` parameter, builds SRT content in memory, writes file, returns `SrtResult`
- `_resolve_output_dir` default changed to `output/srt` under project root (not `__file__.parent/output`)
- `_resolve_output_filename` now prepends `file_id_`

- [ ] **Step 3: Verify the module imports cleanly**

Run: `cd /Users/rio/repos/myprjs/voiceclone/backend && python -c "from app.services.voice_to_srt_service import VoiceToSrt, SrtResult; print('OK')"`
Expected: prints `OK`

- [ ] **Step 4: Commit**

```bash
git add backend/app/services/voice_to_srt_service.py
git commit -m "refactor: VoiceToSrt returns SrtResult with content, language info, and file_id naming"
```

---

### Task 3: Create the speech-to-text API router

**Files:**
- Create: `backend/app/api/speech_to_text.py`
- Modify: `backend/main.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_api_speech_to_text.py`:

```python
import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch, Mock
from pathlib import Path

from main import app

client = TestClient(app)


def test_transcribe_success(sample_audio_file, mock_voice_to_srt):
    """测试语音转字幕成功"""
    with open(sample_audio_file, 'rb') as f:
        response = client.post(
            "/api/speech-to-text/transcribe",
            files={"file": ("test.wav", f, "audio/wav")},
            data={"model_size": "tiny", "beam_size": "1"},
        )
    assert response.status_code == 200
    data = response.json()
    assert "file_id" in data
    assert "content" in data
    assert "filename" in data
    assert "language" in data
    assert "language_probability" in data
    assert "download_url" in data
    assert data["download_url"].startswith("/api/speech-to-text/download/")


def test_transcribe_unsupported_format():
    """测试上传不支持的文件格式"""
    response = client.post(
        "/api/speech-to-text/transcribe",
        files={"file": ("test.txt", b"hello", "text/plain")},
    )
    assert response.status_code == 400


def test_download_not_found():
    """测试下载不存在的文件"""
    response = client.get("/api/speech-to-text/download/nonexistent-id")
    assert response.status_code == 404
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/rio/repos/myprjs/voiceclone/backend && python -m pytest tests/test_api_speech_to_text.py -v`
Expected: FAIL — module `app.api.speech_to_text` not found

- [ ] **Step 3: Create the API router**

Create `backend/app/api/speech_to_text.py`:

```python
import os
import uuid
import tempfile
from pathlib import Path

from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from fastapi.responses import FileResponse

from app.core.config import settings
from app.services.voice_to_srt_service import VoiceToSrt

router = APIRouter()

ALLOWED_EXTENSIONS = {"wav", "mp3"}
WHISPER_MODEL_SIZES = {"tiny", "base", "small", "medium", "large-v3"}


def _find_srt_by_file_id(file_id: str) -> Path | None:
    """Scan the SRT output directory for a file starting with the given file_id."""
    srt_dir = settings.srt_output_dir
    if not srt_dir.exists():
        return None
    for f in srt_dir.iterdir():
        if f.name.startswith(f"{file_id}_") and f.suffix == ".srt":
            return f
    return None


@router.post("/transcribe")
async def transcribe(
    file: UploadFile = File(...),
    model_size: str = Form("large-v3"),
    beam_size: int = Form(5),
):
    file_ext = file.filename.split(".")[-1].lower() if "." in file.filename else ""
    if file_ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file format: {file_ext}. Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}",
        )

    if model_size not in WHISPER_MODEL_SIZES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid model_size: {model_size}. Allowed: {', '.join(sorted(WHISPER_MODEL_SIZES))}",
        )

    # Save uploaded file to temp location
    file_id = str(uuid.uuid4())
    with tempfile.NamedTemporaryFile(suffix=f".{file_ext}", delete=False) as tmp:
        content = await file.read()
        if not content:
            os.unlink(tmp.name)
            raise HTTPException(status_code=400, detail="Empty file")
        tmp.write(content)
        tmp_path = tmp.name

    try:
        service = VoiceToSrt()
        result = service.voicetosrt(
            input_file=tmp_path,
            file_id=file_id,
            model_size=model_size,
            beam_size=beam_size,
        )
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
        "download_url": f"/api/speech-to-text/download/{file_id}",
    }


@router.get("/download/{file_id}")
async def download_srt(file_id: str):
    srt_path = _find_srt_by_file_id(file_id)
    if not srt_path or not srt_path.exists():
        raise HTTPException(status_code=404, detail="SRT file not found")
    return FileResponse(
        path=str(srt_path),
        media_type="text/plain",
        filename=srt_path.name,
    )
```

- [ ] **Step 4: Register the router in main.py**

In `backend/main.py`, add the import and router registration. After the existing router imports (`from app.api import clone, tts, config`), add:

```python
from app.api import speech_to_text
```

After the existing `app.include_router` lines, add:

```python
app.include_router(speech_to_text.router, prefix="/api/speech-to-text", tags=["speech-to-text"])
```

- [ ] **Step 5: Add mock fixture to conftest.py**

In `backend/tests/conftest.py`, add at the end (before the `cleanup_test_files` fixture):

```python
@pytest.fixture
def mock_voice_to_srt():
    """模拟 VoiceToSrt 服务"""
    from app.services.voice_to_srt_service import SrtResult

    mock_result = SrtResult(
        file_path=Path("/tmp/fake.srt"),
        content="1\n00:00:01,000 --> 00:00:03,500\nHello world\n\n",
        filename="test_20260521_143052.srt",
        language="en",
        language_probability=0.98,
    )

    with patch("app.api.speech_to_text.VoiceToSrt") as mock_class:
        mock_instance = Mock()
        mock_instance.voicetosrt.return_value = mock_result
        mock_class.return_value = mock_instance
        yield mock_instance
```

- [ ] **Step 6: Run the tests**

Run: `cd /Users/rio/repos/myprjs/voiceclone/backend && python -m pytest tests/test_api_speech_to_text.py -v`
Expected: All 3 tests PASS

- [ ] **Step 7: Commit**

```bash
git add backend/app/api/speech_to_text.py backend/main.py backend/tests/test_api_speech_to_text.py backend/tests/conftest.py
git commit -m "feat: add speech-to-text API endpoints for transcription and download"
```

---

### Task 4: Add speechToTextApi to frontend API client

**Files:**
- Modify: `frontend/src/services/api.ts`

- [ ] **Step 1: Add the speechToTextApi object**

In `frontend/src/services/api.ts`, add at the end of the file (before the final export or at the bottom):

```typescript
export interface TranscribeResult {
  file_id: string;
  filename: string;
  content: string;
  language: string;
  language_probability: number;
  download_url: string;
}

export const speechToTextApi = {
  transcribe: async (
    file: File,
    modelSize: string = 'large-v3',
    beamSize: number = 5,
  ): Promise<TranscribeResult> => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('model_size', modelSize);
    formData.append('beam_size', String(beamSize));
    const { data } = await api.post<TranscribeResult>('/speech-to-text/transcribe', formData);
    return data;
  },
};
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /Users/rio/repos/myprjs/voiceclone/frontend && npx tsc --noEmit`
Expected: No errors related to the new code

- [ ] **Step 3: Commit**

```bash
git add frontend/src/services/api.ts
git commit -m "feat: add speechToTextApi and TranscribeResult type to frontend API client"
```

---

### Task 5: Create the SpeechToText page component and styles

**Files:**
- Create: `frontend/src/pages/SpeechToText.tsx`
- Create: `frontend/src/pages/SpeechToText.module.css`

- [ ] **Step 1: Create the CSS module**

Create `frontend/src/pages/SpeechToText.module.css`:

```css
.container {
  max-width: 1200px;
  margin: 0 auto;
  padding: var(--spacing-2xl);
}

.header {
  margin-bottom: var(--spacing-2xl);
  text-align: center;
}

.header h1 {
  font-size: var(--font-size-3xl);
  margin-bottom: var(--spacing-sm);
  font-weight: 600;
  letter-spacing: -0.02em;
}

.header p {
  color: var(--color-text-secondary);
}

.content {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--spacing-2xl);
}

.inputSection,
.resultSection {
  display: flex;
  flex-direction: column;
}

.card {
  background: var(--color-surface);
  border-radius: var(--radius-lg);
  padding: var(--spacing-lg);
  border: 1px solid var(--color-border-light);
}

.card h2 {
  margin-bottom: var(--spacing-md);
  font-size: var(--font-size-xl);
  font-weight: 600;
}

.uploadZone {
  border: 2px dashed var(--color-border);
  border-radius: var(--radius-lg);
  padding: var(--spacing-2xl);
  text-align: center;
  cursor: pointer;
  transition: border-color var(--transition-normal), background var(--transition-normal);
}

.uploadZone:hover,
.uploadZone.dragOver {
  border-color: var(--color-primary);
  background: rgba(99, 102, 241, 0.05);
}

.uploadZone.hasFile {
  border-color: var(--color-success, #10b981);
  border-style: solid;
}

.uploadIcon {
  font-size: 48px;
  margin-bottom: var(--spacing-md);
  opacity: 0.5;
}

.uploadText {
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  margin-bottom: var(--spacing-xs);
}

.uploadHint {
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
  opacity: 0.7;
}

.fileName {
  color: var(--color-primary);
  font-weight: 600;
  font-size: var(--font-size-base);
}

.params {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
  margin-top: var(--spacing-lg);
}

.actionRow {
  margin-top: var(--spacing-lg);
}

.resultHeader {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--spacing-md);
}

.languageBadge {
  display: inline-flex;
  align-items: center;
  gap: var(--spacing-xs);
  background: var(--color-surface-hover);
  padding: var(--spacing-xs) var(--spacing-md);
  border-radius: var(--radius-full);
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}

.srtPreview {
  width: 100%;
  min-height: 300px;
  padding: var(--spacing-md);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-md);
  background: var(--color-background);
  color: var(--color-text-primary);
  font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
  font-size: var(--font-size-sm);
  resize: vertical;
  outline: none;
}

.srtPreview:focus {
  border-color: var(--color-primary);
}

.downloadRow {
  margin-top: var(--spacing-md);
  display: flex;
  gap: var(--spacing-sm);
}

.processing {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--spacing-2xl);
  color: var(--color-text-secondary);
}

.processingText {
  margin-top: var(--spacing-md);
  font-size: var(--font-size-base);
}

@media (max-width: 768px) {
  .content {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 2: Create the page component**

Create `frontend/src/pages/SpeechToText.tsx`:

```typescript
import { useState, useRef, useCallback } from 'react';
import { speechToTextApi, TranscribeResult } from '../services/api';
import { Button } from '../components/ui/Button';
import { Select } from '../components/ui/Select';
import { Slider } from '../components/ui/Slider';
import { Loading } from '../components/ui/Loading';
import styles from './SpeechToText.module.css';

const MODEL_OPTIONS = [
  { value: 'tiny', label: 'Tiny (fastest, least accurate)' },
  { value: 'base', label: 'Base' },
  { value: 'small', label: 'Small' },
  { value: 'medium', label: 'Medium' },
  { value: 'large-v3', label: 'Large-v3 (slowest, most accurate)' },
];

export function SpeechToText() {
  const [file, setFile] = useState<File | null>(null);
  const [modelSize, setModelSize] = useState('large-v3');
  const [beamSize, setBeamSize] = useState(5);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<TranscribeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = useCallback((selectedFile: File) => {
    const ext = selectedFile.name.split('.').pop()?.toLowerCase();
    if (ext !== 'wav' && ext !== 'mp3') {
      setError('Only .wav and .mp3 files are supported');
      return;
    }
    setFile(selectedFile);
    setResult(null);
    setError(null);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const droppedFile = e.dataTransfer.files[0];
      if (droppedFile) handleFileSelect(droppedFile);
    },
    [handleFileSelect],
  );

  const handleTranscribe = async () => {
    if (!file) return;
    setProcessing(true);
    setError(null);
    try {
      const res = await speechToTextApi.transcribe(file, modelSize, beamSize);
      setResult(res);
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Transcription failed');
    } finally {
      setProcessing(false);
    }
  };

  const handleDownload = () => {
    if (!result) return;
    const link = document.createElement('a');
    link.href = result.download_url;
    link.download = result.filename;
    link.click();
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1>语音转字幕</h1>
        <p>上传音频文件，使用 Whisper 模型识别语音并生成 SRT 字幕</p>
      </div>

      <div className={styles.content}>
        <div className={styles.inputSection}>
          <div className={styles.card}>
            <h2>上传音频</h2>
            <div
              className={`${styles.uploadZone} ${dragOver ? styles.dragOver : ''} ${file ? styles.hasFile : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              {file ? (
                <>
                  <div className={styles.uploadIcon}>🎵</div>
                  <div className={styles.fileName}>{file.name}</div>
                  <div className={styles.uploadHint}>点击更换文件</div>
                </>
              ) : (
                <>
                  <div className={styles.uploadIcon}>📁</div>
                  <div className={styles.uploadText}>拖拽音频文件到此处，或点击选择</div>
                  <div className={styles.uploadHint}>支持 .wav, .mp3 格式</div>
                </>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".wav,.mp3"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFileSelect(f);
              }}
            />

            <div className={styles.params}>
              <Select
                label="模型大小"
                options={MODEL_OPTIONS}
                value={modelSize}
                onChange={(e) => setModelSize(e.target.value)}
              />
              <Slider
                label="Beam Size"
                value={beamSize}
                onChange={setBeamSize}
                min={1}
                max={10}
                step={1}
              />
            </div>

            <div className={styles.actionRow}>
              <Button
                variant="primary"
                fullWidth
                loading={processing}
                disabled={!file || processing}
                onClick={handleTranscribe}
              >
                {processing ? '识别中...' : '开始识别'}
              </Button>
            </div>
          </div>
        </div>

        <div className={styles.resultSection}>
          <div className={styles.card}>
            <h2>识别结果</h2>
            {processing && (
              <div className={styles.processing}>
                <Loading size="lg" />
                <div className={styles.processingText}>正在识别语音，请耐心等待...</div>
              </div>
            )}
            {error && <div style={{ color: 'var(--color-danger)' }}>{error}</div>}
            {result && !processing && (
              <>
                <div className={styles.resultHeader}>
                  <span className={styles.languageBadge}>
                    {result.language} ({(result.language_probability * 100).toFixed(1)}%)
                  </span>
                </div>
                <textarea
                  className={styles.srtPreview}
                  value={result.content}
                  readOnly
                />
                <div className={styles.downloadRow}>
                  <Button variant="primary" onClick={handleDownload}>
                    下载 SRT 文件
                  </Button>
                </div>
              </>
            )}
            {!result && !processing && !error && (
              <div style={{ color: 'var(--color-text-secondary)', textAlign: 'center', padding: 'var(--spacing-2xl)' }}>
                上传音频并点击识别，结果将显示在这里
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd /Users/rio/repos/myprjs/voiceclone/frontend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/SpeechToText.tsx frontend/src/pages/SpeechToText.module.css
git commit -m "feat: add SpeechToText page with upload, params, preview, and download"
```

---

### Task 6: Add navigation tab in App.tsx

**Files:**
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Update App.tsx to include the new tab**

Replace the entire content of `frontend/src/App.tsx` with:

```typescript
import { useState } from 'react';
import { VoiceClone } from './pages/VoiceClone';
import { TTSSynthesis } from './pages/TTSSynthesis';
import { SpeechToText } from './pages/SpeechToText';
import styles from './App.module.css';

type Tab = 'voice-clone' | 'tts-synthesis' | 'speech-to-text';

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('voice-clone');

  return (
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
      </header>

      <main className={styles.main}>
        {activeTab === 'voice-clone' && <VoiceClone />}
        {activeTab === 'tts-synthesis' && <TTSSynthesis />}
        {activeTab === 'speech-to-text' && <SpeechToText />}
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Verify the app builds**

Run: `cd /Users/rio/repos/myprjs/voiceclone/frontend && npm run build`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add frontend/src/App.tsx
git commit -m "feat: add speech-to-text navigation tab in App"
```

---

### Task 7: End-to-end smoke test

**Files:** None (manual verification)

- [ ] **Step 1: Start the backend**

Run: `cd /Users/rio/repos/myprjs/voiceclone/backend && python -m uvicorn main:app --host 127.0.0.1 --port 8002`

- [ ] **Step 2: Start the frontend dev server**

Run: `cd /Users/rio/repos/myprjs/voiceclone/frontend && npm run dev`

- [ ] **Step 3: Open the browser**

Navigate to the app, click the "语音转字幕" tab.

- [ ] **Step 4: Test the upload and transcription flow**

1. Upload a .wav or .mp3 file
2. Select a model size (use "tiny" for fast testing)
3. Click "开始识别"
4. Verify: SRT content appears in the preview area
5. Verify: Language badge shows detected language
6. Click "下载 SRT 文件"
7. Verify: File downloads successfully

- [ ] **Step 5: Test error case**

Try uploading a .txt file — should show an error message.

- [ ] **Step 6: Run all backend tests**

Run: `cd /Users/rio/repos/myprjs/voiceclone/backend && python -m pytest tests/ -v`
Expected: All tests pass

- [ ] **Step 7: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: address issues found during smoke test"
```
