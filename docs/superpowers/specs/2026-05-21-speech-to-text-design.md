# Speech-to-Text (Voice to SRT) Feature Design

## Goal

Add a speech-to-text feature that lets users upload audio files (.wav, .mp3), transcribe them using Whisper (faster-whisper), preview the generated SRT subtitle content inline, and download the SRT file.

## Decisions

- **New standalone page** at `/speech-to-text` — separate from TTS and Voice Clone
- **Synchronous processing** — single request, loading spinner while transcribing
- **Selectable model size** with large-v3 default (tiny, base, small, medium, large-v3)
- **Preview + download** — SRT content shown inline with a download button

## Backend

### API Endpoints

New router file: `app/api/speech_to_text.py`, registered at `/api/speech-to-text`.

#### POST `/api/speech-to-text/transcribe`

Accepts `multipart/form-data`:

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| file | File | Yes | — | Audio file (.wav, .mp3) |
| model_size | string | No | "large-v3" | Whisper model size |
| beam_size | int | No | 5 | Beam search size |

Response (200):

```json
{
  "file_id": "uuid-string",
  "filename": "audio_20260521_143052.srt",
  "content": "1\n00:00:01,000 --> 00:00:03,500\nHello world\n\n2\n...",
  "language": "en",
  "language_probability": 0.98,
  "download_url": "/api/speech-to-text/download/uuid-string"
}
```

Error (400): unsupported file format, empty file, etc.
Error (500): transcription failure.

#### GET `/api/speech-to-text/download/{file_id}`

Returns the SRT file as a `FileResponse` with `Content-Disposition: attachment` and `media_type="text/plain"`.

Returns 404 if file not found.

### Service Layer

Modify `app/services/voice_to_srt_service.py`:

- Refactor `voicetosrt()` to return both the file path AND the SRT content string, so the API doesn't need to re-read the file.
- Output directory: `backend/output/srt/` (configurable via `OUTPUT_DIR` env var, same as current logic).
- File naming: `{stem}_{timestamp}.srt` with a UUID-based `file_id` prefix for the download endpoint.
- The service should accept an uploaded file path (from the API handler's temp save), not handle file upload itself.

### Router Registration

In `main.py`, add:
```python
from app.api import speech_to_text
app.include_router(speech_to_text.router, prefix="/api/speech-to-text", tags=["speech-to-text"])
```

### File Storage

- SRT files saved to `backend/output/srt/`
- Files served by `file_id` (UUID) — no database model needed
- The `file_id` is embedded in the filename for lookup: `{file_id}_{stem}_{timestamp}.srt`

## Frontend

### New Page: `SpeechToText.tsx`

Route: `/speech-to-text`

Layout (top to bottom):

1. **Upload area** — drag-and-drop or click to upload, accept .wav/.mp3, show selected filename
2. **Parameters** — model size dropdown (default: large-v3), beam size slider (1-10, default 5)
3. **Transcribe button** — disabled until file selected, shows spinner during processing
4. **Result section** (appears after transcription):
   - Detected language and confidence
   - SRT content preview in a scrollable textarea
   - Download button linking to the `download_url`

### API Client

Add to `services/api.ts`:

```typescript
export const speechToTextApi = {
  transcribe: async (file: File, modelSize: string = 'large-v3', beamSize: number = 5) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('model_size', modelSize);
    formData.append('beam_size', String(beamSize));
    const response = await api.post('/speech-to-text/transcribe', formData);
    return response.data;
  },
};
```

### Navigation

Add "Speech to Text" tab/link alongside existing TTS and Voice Clone navigation items.

## Scope

- No audio recording (upload only)
- No SRT editing
- No history of past transcriptions (files stay on disk but no list API)
- No async/background task support
