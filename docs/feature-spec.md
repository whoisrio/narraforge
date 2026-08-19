# NarraForge — Feature Specification

**Version**: 2.0
**Date**: 2026-06-26
**Status**: Current

---

## 1. Overview

NarraForge is an AI narration workshop that integrates voice cloning, text-to-speech synthesis, speech-to-text transcription, and a segmented project editor for producing multi-chapter audio narrations. It supports four TTS engines (Edge-TTS, CosyVoice, MiMo-TTS, VoxCPM) and two STT engines (Whisper, FunASR).

**Tech Stack**: React 19 + TypeScript + Vite (frontend), Python 3.12+ / FastAPI / SQLAlchemy (backend), IndexedDB + SQLite for persistence.

---

## 2. Navigation Structure

The application uses a two-tier navigation architecture:

### Global Sidebar

A fixed left sidebar (`AppShell`) provides top-level navigation:

| Item | Internal View | Description |
|------|---------------|-------------|
| Projects | `tts-synthesis` | ProjectHub project list → project workspace |
| Subtitles | `speech-to-text` | Transcription Hub |
| Voice Design | `voice-clone` | Voice cloning and design |
| Settings | `model-config` | Provider API key management |

The sidebar **hides** when a project workspace is active, giving full width to the editor.

### ProjectHub (Default View)

When no project is open, the Projects tab shows **ProjectHub** — a card grid of all saved projects with:
- Project name, chapter/segment counts, generated progress
- Quick actions: open, delete, create new
- Scratchpad project for quick drafts

### Project Workspace

Opening a project enters the workspace with a left rail (`ProjectShell`) containing:
- Project identity (name + subtitle)
- "Back to projects" button
- Section navigation (5 sections, see below)
- Chapter list (visible in Library/Studio sections): select, rename, delete, and reorder (↑/↓) chapters; the active chapter's voice config is inherited by new chapters

---

## 3. Voice Design (`/voice-clone`)

### 3.1 Page Structure

The page title is "音色设计". It has two inline panels triggered by action buttons, plus a voice profile grid:

| Element | Description |
|---------|-------------|
| "设计新音色" button | Opens the voice design panel |
| "克隆声音" button | Opens the voice clone panel |
| Voice Profile Grid | Card grid of all saved voices with preview buttons |

Panels expand inline below the header — there are no tabs.

### 3.2 Clone Engines

Three clone engines are supported:

| Engine | Method | Registration | Lifecycle |
|--------|--------|--------------|-----------|
| **CosyVoice (Qwen)** | URL → cloud register → `voice_id` (record/upload only in global VoiceClone page) | Persistent; reuse `voice_id` indefinitely | Best for batch synthesis |
| **MiMo-TTS** | Upload/record → local base64, stateless | No registration; audio sent each time | Best for quick tests |
| **VoxCPM** | Upload/record → local GPU inference | No registration; uses local audio path | Best for local high-fidelity clone |

> **Note:** Project roles (ProjectVoices) restrict CosyVoice to URL-only input. The global VoiceClone page still supports record/upload/URL for CosyVoice.

### 3.3 Clone Flow

1. **Choose Engine** — CosyVoice / MiMo / VoxCPM
2. **Input Audio** — Record (microphone), upload (MP3/WAV/WebM), or URL. The chosen input method is stored in `engine_params.input_method` for later restoration
3. **Preview & Clone** — Review sample, name the voice, submit for cloning
4. **Voice Profile Created** — Saved with `source_audio_path` (source audio) and engine metadata including `input_method`

CosyVoice clones register with Qwen cloud and store `qwen_voice_id`. MiMo/VoxCPM clones are stateless — the audio file is read and sent at synthesis time.

**Edit & Delete:** Existing voices can be edited (re-recorded/re-uploaded) or deleted from both the global VoiceClone page and ProjectVoices role cards. Editing replaces the old voice on success.

### 3.4 Voice Design Flow

Two sub-engines for voice design from text descriptions:

| Sub-engine | Method | Output |
|------------|--------|--------|
| **MiMo** | Text description → `/api/mimo-tts/voicedesign` | MP3 audio preview |
| **VoxCPM** | Text description → VoxCPM design endpoint | WAV audio preview |

Flow:
1. **Describe** — Enter a natural-language voice description
2. **Preview** — System synthesizes a sample. MiMo voicedesign uses `optimize_text_preview=false` for verbatim text
3. **Save** — Persists audio as a `VoiceProfile` via `/api/clone/create-from-design`

### 3.5 Voice Profile Cards

Each card shows:
- VoiceAvatar (40px), name, engine label chip, input method chip (录制/上传/URL), description chip
- "试听" button — plays the saved audio directly via `audio_url`
- "编辑" button — opens clone panel for re-recording/re-uploading
- "删除" button — removes the voice profile

### 3.6 Voice Refresh

A shared `useVoiceRefresh` hook triggers cross-component refresh after clone/design success. Both the voice list and TTS voice selectors update automatically.

---

## 4. Projects (`/tts-synthesis`)

### 4.1 Project Structure

A project is the primary organizational unit. It contains chapters, which contain segments. There is **no single mode** — all TTS work happens within a project.

```
Project
├── Chapters[]
│   ├── original_text (narration manuscript)
│   ├── segments[] (TTS units)
│   └── default_params (engine/voice settings)
├── source_document (raw source markdown)
├── default_narrator_role_id
└── roles (narrator + cast)
```

### 4.2 ProjectShell Sections

The project workspace has 5 sections accessible via the left rail:

| Section | Component | Description |
|---------|-----------|-------------|
| **Overview** | `ProjectOverview` | Project summary, chapter list, narrator info, quick navigation |
| **Library** | `ProjectLibrary` | Source document + narration chapters; fulltext view is an adaptive narration-document editor (`NarrationDocView`): empty `narration_script` shows joined-chapter preview + paste/generate-from-chapters entries, non-empty shows edit/preview toggle + split-by-heading button |
| **Studio** | `VoiceStudioLayout` | Main segmented TTS editor with chapter sidebar |
| **Voices** | `ProjectVoices` | Role management: narrator + cast roles with voice configuration |
| **Settings** | `ProjectSettings` | Project metadata, export config, Remotion path |

### 4.3 TTS Engines

Four TTS engines are available:

| Engine | Source | Features |
|--------|--------|----------|
| **Edge-TTS** | Microsoft, online | Free, multi-language, no API key required |
| **CosyVoice (Qwen)** | Cloud API | Uses cloned voice IDs, SSML support |
| **MiMo-TTS** | Cloud API | Preset voices, voice design, voice clone modes |
| **VoxCPM** | Local GPU | Clone, ultimate clone, design modes; CFG/timestep params |

#### Style Tag System

Segments may carry two kinds of style markup (see `docs/dependecy-api-references/voice-style-tags.md`):

- **Inline non-verbal tags** — `[laughing]`, `[sigh]`, `[Uhm]` etc. embedded in the segment text at the position where the sound should occur. Only **VoxCPM** (clone/design modes) supports them.
- **Leading style tag** — a `(风格)` prefix derived from the segment's `emotion` and/or the chapter's style instruction, merged into one parenthesis pair joined by `,` (e.g. `(开心,磁性)`). Supported by **MiMo-TTS** and **VoxCPM**; MiMo only accepts it at the very beginning.

Engine adaptation is rule-driven (mirrored tables: `backend/app/services/engine_capabilities.py` and `frontend/src/services/styleTags.ts`):

| Engine / mode | Inline `[tag]` | Leading `(风格)` | Instruction |
|---|---|---|---|
| MiMo-TTS | stripped | kept (leading only) | user message |
| VoxCPM clone/design | kept | kept | text prefix |
| VoxCPM ultimate | stripped | stripped | — |
| CosyVoice | stripped | — | dedicated param |
| Edge-TTS | stripped | — | — |

Rules: at synthesis time `prepare_text_for_engine` strips unsupported tags and injects the leading tag (emotion first, style after, comma-joined); a chapter-level **mute_tags** switch ("禁用风格 tag", recommended for clone voices) forces full stripping; a chapter-level **underscore_to_space** switch ("合成时把下划线转为空格") replaces `_` with a space in the text sent to the engine only — display, subtitle exports, and stored history keep the original text; a project-level global switch in Project Settings (`configs.underscore_to_space`) does the same project-wide, and either switch being on enables the conversion; SRT/subtitle exports always strip all tags. The narration workflow asks for the TTS engine (countdown interrupt with a default before segment splitting) and the LLM injects inline tags only when VoxCPM is selected. Tags can also be inserted manually in the segment editor via the tag inserter. Emotion chips render with per-emotion colors in both compact and expanded studio views.

### 4.4 Studio — Segmented Editor

The Studio section is a professional timeline editor for multi-segment synthesis.

#### Text Input & Split

| Mode | Description |
|------|-------------|
| **Rule** | Split by punctuation delimiters (default: `，`, `。`, `！`, `？`), customizable |
| **LLM** | LLM-powered semantic splitting with emotion analysis per segment |

#### Emotion System

- Six emotion types: `happy`, `sad`, `angry`, `calm`, `neutral`, `excited`
- Chinese labels: 欣喜, 沉重, 愤怒, 沉稳, 中性, 激昂
- Each emotion maps to a distinct card color
- Manual override per segment

#### Segment Lifecycle

```
idle → queued → pending → ready
                     ↘ failed → (retry) → pending
```

#### Narrator Voice Sidebar

The Studio sidebar has a **Narrator Voice** panel with engine selector (Edge-TTS / CosyVoice / MiMo-TTS / VoxCPM) and engine-specific parameter controls. All controls update **panel state immediately** but do NOT affect existing segments. A segmented narración does not reference engine-voice from the panel at real-time.

An **Apply** button at the bottom:
1. Opens a confirmation dialog
2. On confirm, writes `buildCurrentParams()` → `Chapter.voice` via `SET_DEFAULT_PARAMS`
3. All chapter-source segments refresh their display from the saved `Chapter.voice`
4. Segments whose `generated_params` differ from the new `Chapter.voice` are flagged as stale

Until Apply is clicked, the panel voice selection has zero effect on segment display or staleness.

#### Per-Segment Voice Source

Each segment has a `voice` field of type `VoiceSource`:

| Source | Display | Behavior |
|--------|---------|----------|
| `chapter` | Shows `Chapter.voice` (applied voice) | Follows global; stale when generated_params ≠ chapterVoice |
| `role` | Shows role name | Follows assigned role's voice |
| `custom` | Shows custom `params`, falls back to `chapterVoice` if empty | Locked independent voice |

Lock toggle (🔗↔🔒): `TOGGLE_INDEPENDENT_VOICE` switches between `chapter` and `custom` source. When locking, `params` is initially empty — the display falls back to `chapterVoice` until the segment is regenerated with custom params.

Additional per-segment features:
- Text editing, SSML annotation (CosyVoice), engine/voice override
- Override tracking via `overrides` array
- Undo regenerate (swap current/previous audio)
- Insert/delete/reorder segments (↑/↓ buttons per row; reorder renumbers `position` to match array order so the backend persists the new sequence)
- Role assignment (narrator or cast)

#### Self-Recorded Segment Audio (自行录入)

Each segment row has a 🎙 record button for cases where TTS quality is poor on an individual segment.

- Input modes: microphone recording (reuses the VoiceClone `AudioRecorder`) or local audio file upload (mp3/wav/webm/ogg/m4a), with in-panel preview before confirming.
- If the segment already has audio, confirming shows an overwrite warning; the replaced audio is demoted to `audio.previous` so undo-regenerate can still restore it.
- The recorded audio is stored through the same `audio.current` channel as TTS audio, so playback, chapter export, SRT timelines, and Remotion scaffolding work unchanged.
  Frontend storage mode saves the blob to IndexedDB (`source: 'segmented_record'`, excluded from TTS history); backend storage mode uploads via `POST .../segments/{sid}/audio`, which transcodes to mp3 and stores under a unique `*.rec-*` filename.
- Recorded segments are marked `audio.current.origin === 'recorded'` and shown with a 🔒「录入」badge.
  They are locked: Generate All, workflow/agent batch synthesis, and plain regenerate all skip them.
  Clicking the 🔒 badge unlocks (confirm dialog); the next regenerate sends `force: true` and demotes the recording to `previous` (undoable).

#### Stale Detection

Segments are compared against `Chapter.voice` (the applied/saved voice), NOT the live panel state. This means:

- Changing the voice selector in the sidebar does **not** trigger stale warnings
- Only after clicking **Apply** (and `Chapter.voice` is updated) do segments with mismatched `generated_params` show a stale ⚠ warning
- Locked segments (`voice.source === 'custom'`) are never stale from global voice changes

#### Batch Operations

| Action | Description |
|--------|-------------|
| Generate All (menu) | The 批量合成 button opens a menu: 「仅合成未合成」 synthesizes only idle/failed segments (existing audio untouched); 「重新合成全部」 regenerates idle/failed + ready-but-not-voice-locked segments (previous behavior). Recorded (`origin === 'recorded'`) segments are always skipped. |
| Produce All (一键制作全本) | Transport-bar dropdown (backend storage mode only): 「增量制作全本」 / 「覆盖重制全本」, mirroring the per-chapter menu but project-wide. Phase 1: rule-split chapters that have **no segments** yet (`text = narration_script || original_text`), new segments inherit chapter voice (non-destructive to chapters that already have segments). Phase 2: collect targets across all chapters — 增量 targets idle/failed (incl. desynced file-lost segments), 覆盖 additionally regenerates ready non-custom segments; recorded always skipped. Phase 3: sequential synth reusing each segment's existing voice config. No new settings UI. |
| Play All | Sequential playback of all ready segments |
| Export | WAV/JSON/SRT/bilingual SRT export |
| Export All (导出全部) | One-click export of **all chapters**' mp3 + chapter-local SRT to the project export directory (`configs.export_directory`; absolute path works without a Remotion path). Backend storage mode only. Pre-checks every chapter first: any segment missing audio aborts the whole export with a 409 listing the incomplete chapters and per-chapter `missing_counts`. The check is strict on purpose — the "export always reports incomplete" symptom was traced to a UI false-ready: segments showed ready based on DB `audio.current` alone, without verifying the mp3 exists on disk. Fix: the backend now returns `audio.current.file_exists` (stat) and the frontend marks a segment ready only when `current.path && current.file_exists !== false`, so file-lost segments drop to idle and become produce-all / unsynthesized targets. |
| Batch delete (批量删除) | 「选择」toggle in the toolbar enters selection mode: every row (compact + expanded) gets a leading checkbox, with 全选/取消全选 and a danger 「删除选中 (N)」 button. Confirm dialog warns how many selected segments have audio; deletion removes IndexedDB blobs (frontend mode) / relies on save_project reconcile (backend mode) and dispatches one `DELETE_SEGMENTS` action. |

### 4.5 Library — Doc-First Views

The Library is organized into three first-class views plus an immersive chapter editor, switched from a persistent header switcher:

| View | Description |
|------|-------------|
| **Full Text (doc, default)** | The narration document (`narration_script`) as the master text. Header: stats (chars / estimated duration / chapter count) + actions (edit/preview toggle, 按标题拆分章节). Empty-document form A: paste CTA primary button + "去源文档" secondary button (jumps to Source view); when chapter text exists, a "从现有章节生成" fallback is kept. |
| **Chapters** | The chapter card grid (rename/delete/create, progress bars, open text, enter Studio). "新建章节" lives in this view's header. |
| **Source** | Raw source document. Textarea editing + react-markdown view mode, 500ms debounced auto-save, compare entry. Always accessible; the workflow trigger block (生成旁白 / 知识视频 → `WorkflowDrawer`) renders only when the `agent_workflow` capability is on. |

The default view is `doc`; each project remembers its last view in `localStorage` (`nf.library.view.{projectId}`, silent fallback to `doc`).
The storyboard (`StoryboardPanel`) entry is removed from the switcher for now; the component itself is kept.
`onModeChange` reports `'doc' | 'chapters' | 'source' | 'chapter'`.

**Chapter editor**: single-chapter immersive editor with edit/preview toggle, opened from a chapter card; back returns to the chapters view.

**Compare View**: side-by-side two-column layout comparing source (left) vs narration (right), entered from the Source view.

#### Chapter Split (按标题拆分章节)

The doc view header offers "按标题拆分章节" (`ChapterSplitModal`).
Flow: `markdown-detect` probes heading levels → user picks levels → `markdown-split` previews → apply calls `chapters:batch`, which replaces all chapters in one transaction.
Applied chapter titles get a zero-padded numeric prefix (`01. …`) matching the chapter card badges.
Chapters shorter than 80 chars (`min_chars`) are merged into the next chapter by `markdown-split`.

**"同时拆分 segment" option** (`split_segments`):
when checked, chapters without payload segments are split server-side by `rule_split` using the chapter's effective `split_config.delimiters`.
Rule precedence: explicit payload `split_config` > carried-over `split_config` of the title-matched old chapter > default (`，。！？；`).
Chapters whose stored mode is `llm` still split by rule in this batch path (no per-chapter LLM calls).
On a first split (no existing chapters) the checkbox is shown and defaults to checked, so the result is immediately usable in Studio.
On a re-split (existing chapters) the checkbox is hidden and `split_segments: true` is always sent — preserving audio semantically implies rebuilding segments, so the "empty chapters + delete all audio" combination no longer exists.

**Audio preservation on re-split** (`preserve_audio`, sent automatically when the project already has chapters):
old chapters are matched by normalized title (leading `01.` numbering ignored, so inserting a chapter mid-document still matches), and new segments are matched to old segments by exact stripped text, each old segment consumed at most once.
Matching runs in two phases: exact matches within the title-matched chapter first, then a global fallback pool of all unconsumed old segments — so restructuring one chapter into several (segment texts untouched) still reuses audio across chapters.
A matched segment carries over its `audio`, `generated_params`, `emotion`, `role_id`, and `voice` override — including `origin="recorded"` self-recordings.
When a re-split payload chapter has no `segments` and title-matches an old chapter that has segments, the chapter is automatically `rule_split` with its effective delimiters (same precedence as above), so the default modal path rebuilds segments instead of producing empty chapters.
In local storage mode the audio file is moved to the new chapter/segment canonical path (`audio.previous` follows the move with the `.prev` naming convention), unreused old files are garbage-collected only after a successful commit, and a commit failure triggers reverse compensation that moves files back to their old paths.
A missing on-disk file means no reuse.

**Honest reuse preview** (`dry_run`):
while the re-split confirmation is open, the modal runs `chapters:batch` with `dry_run: true` in the background and the confirm dialog states the estimated outcome: kept segments, discard breakdown (`text_changed` / `boundary_changed` — a new segment whose text equals the concatenation of consecutive old segments within one old chapter), and a highlighted warning when user recordings (`origin="recorded"`) will be deleted.
If the dry-run call fails, the dialog falls back to the plain message and does not block the split.
The response `reuse` report (kept/discarded breakdown + per-chapter detail) is surfaced as a toast after apply in the same terms.

**Divergence warning**:
`narration_script` is the master document and re-splitting always derives from it.
When the narration document diverges from the concatenated chapter texts (chapter-side edits), the split modal shows a warning that applying uses the document as the source of truth and chapter-side changes will be overwritten.

**After apply**: the UI stays in the doc view and shows a result dialog with the honest reuse report (kept / discard breakdown / recorded warning) and two actions — "查看章节" jumps to the chapters view, "留在文档" dismisses and stays.

In workers (Supabase) mode the same matching applies at row level; audio objects are not file-managed there, so stored refs carry over as-is.
Agent workflow calls never pass these flags — their behavior is unchanged.

### 4.6 Voices — Role Management

The Voices section manages narrator and cast roles:

| Feature | Description |
|---------|-------------|
| Default Narrator | Project-wide default narration voice |
| Cast Roles | Dialogue characters with individual voice configs |
| Voice Source Categories | Model Presets (Edge/MiMo), Clone Voices (CosyVoice/MiMo/VoxCPM), Design New (MiMo/VoxCPM) |
| Preview | Each role has a "试听" button for auditioning |
| Persistence | Roles created in project saved to project role library |

global voices(role) can be used in project , but can not be edit.

### 4.7 Narrator Mode Voice Selection

When in the Studio sidebar, each engine has specific voice source restrictions:

| Engine | Available Voice Sources |
|--------|------------------------|
| **CosyVoice** | Only CosyVoice-cloned voices (`clone_engine='qwen'`) |
| **Edge-TTS** | System default voices |
| **MiMo** | System preset voices OR MiMo/VoxCPM cloned voices (excludes CosyVoice) |
| **VoxCPM** | Only VoxCPM-cloned voices (`clone_engine='voxcpm'`) |

### 4.8 Project Auto-Save & Conflict Detection

- Backend mode: debounce PUT via `useSegmentedDraftSync`
- IndexedDB as draft cache with `base_updated_at` for conflict detection
- 2000ms tolerance: only triggers conflict when backend `updated_at` exceeds local by >2 seconds
- Initial load does not trigger `markDirty` to prevent false conflicts
- Chapter sync-status badges poll only backend-persisted chapters: the page tracks the server-known chapter id set (from GET on load/reload, expanded to all in-memory chapters after each successful autosave via the draft-sync `onSaved` callback), and `ProjectShell` skips polling for in-memory-only chapters — e.g. the default chapter injected when opening an empty project — which would otherwise 404 and spam the console.

---

## 5. Transcription Hub (`/speech-to-text`)

### 5.1 Layout

Two-column layout:
- **Main column**: AudioDropzone (multi-file), TranscriptEditor, CorrectionPanel, TranscriptionHistory
- **Sidebar**: SidebarConfig (engine/model/VAD), QualityReport, ExportPanel, BilingualCard

### 5.2 Engine Support

| Engine | Model Options | Strengths |
|--------|--------------|-----------|
| **Whisper (Faster-Whisper)** | tiny, base, small, medium, large-v3 | 100+ languages, CUDA GPU acceleration |
| **FunASR (Paraformer-ZH)** | paraformer-zh | Chinese-optimized, 3x faster CPU, built-in VAD + punctuation |

### 5.3 Transcription Parameters

| Parameter | Whisper | FunASR | Description |
|-----------|---------|--------|-------------|
| Model size | tiny–large-v3 | paraformer-zh | Accuracy vs speed tradeoff |
| Beam size | 1–10 (default 5) | — | Search beam width |
| VAD | — | Toggle (default on) | Voice Activity Detection via FSMN-VAD |

### 5.4 Input Methods

- Single file: drag-and-drop or click (.wav, .mp3)
- Multi-audio merge: select multiple files, concatenated before transcription

### 5.5 Results

- Editable SRT preview in textarea
- Language detection with confidence score
- Device/compute type badge (GPU/CPU)
- Download SRT file

### 5.6 LLM Subtitle Correction

Two modes: **Smart** (local pre-filtering, only suspected errors sent to LLM) and **Full** (all lines sent). Workflow: provide original script → LLM compares → character-level diff → accept/reject → apply.

### 5.7 Bilingual Subtitle Translation

Target languages: English, Japanese, Korean, French, German, Spanish. Generates dual-language SRT.

---

## 6. Model Configuration (`/model-config`)

Manage API keys and connection settings through a web UI instead of editing `.env`.

### Provider Cards

Each provider is an expandable card with label, icon, status ("已配置" / "使用默认值" / "未配置").

### Behavior

- UI values override `.env` defaults
- Empty UI fields fall back to `.env` automatically
- Password toggle for sensitive fields
- Dirty tracking — only modified fields submitted on save

### Providers

| Provider | Key Fields |
|----------|-----------|
| Qwen (CosyVoice) | `QWEN_API_KEY`, `QWEN_MODEL` |
| MiMo TTS | `MIMO_API_KEY`, `MIMO_BASE_URL` |
| LLM (Subtitle correction) | `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL` |
| FunASR | `FUNASR_MODEL`, `FUNASR_DEVICE` |

---

## 7. Cross-Cutting Features

### 7.1 Storage Mode

A global toggle switches between:

| Mode | TTS History | STT History | Audio Storage |
|------|-------------|-------------|---------------|
| **Frontend** | IndexedDB | IndexedDB | Audio blobs in IndexedDB |
| **Backend** | API calls | API calls | Server-side files |

### 7.2 Audio Caching

- TTS results stored as `TTSLocalRecord` in IndexedDB with full Blob
- STT results stored as `STTLocalRecord` with original audio + SRT
- Segmented editor audio tagged with `source: 'segmented_tts'`

### 7.3 Responsive Layout

- Segmented editor supports vertical (card list) and horizontal (compact block) layouts
- Toggleable via `SET_LAYOUT` action

### 7.4 Multi-User & Anonymous Mode (workers deployment)

Applies only to the workers deployment shape (Vercel serverless + Supabase; see `docs/deployment-feature-matrix.md` for the full feature classification).
Local mode is unchanged: no auth, single-tenant SQLite.

- **Auth**: the frontend build (`VITE_AUTH_REQUIRED=true` + `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`) shows a Supabase email+password login/signup page (`src/pages/Auth.tsx`); axios interceptors attach the Supabase access token and retry once on 401 after token refresh.
- **Per-user isolation**: projects, voice profiles, roles, source documents and TTS results are scoped to the signed-in user (`user_id` ownership, enforced in the backend repository layer); cross-user access returns 404.
- **Per-user project quota**: in backend storage mode a regular logged-in user owns at most `MAX_PROJECTS_PER_USER` (default `1`) projects - creating another is rejected with `409 project_limit_reached` (enforced in the API layer, so it cannot be bypassed from the frontend); legacy admins and `ADMIN_EMAILS` users are exempt. The sidebar hides/disables the create entry once the quota is reached.
- **Per-user designed-voice quota**: in backend storage mode a regular logged-in user keeps at most `MAX_DESIGNED_VOICES_PER_USER` (default `1`) designed voices (`voice.voice_type == "design"`, global + project-scoped combined) - saving another via `POST /clone/create-from-design` (engine `mimo`/`voxcpm`) is rejected with `409 designed_voice_limit_reached`; preset saves and clone uploads do not count; legacy admins and `ADMIN_EMAILS` users are exempt. The save dialog surfaces the quota message from the 409 detail.
- **Anonymous mode**: without login, only stateless features are usable (edge_tts/MiMo synthesis, text split, subtitle LLM, text analysis); storage is fixed to frontend IndexedDB (the backend-storage option is hidden) and non-allowlisted pages show a login CTA.
- **Admin console**: admins (JWT email in `ADMIN_EMAILS`, or legacy `ACCESS_TOKEN`/gateway/Access-header credentials) see a 管理后台 entry in the user menu → `/admin`: overview cards + 30-day DAU/visit charts, users table, operation logs table (backed by `GET /api/admin/*`, see `docs/api-reference.md`).
- Usage stats (visits, DAU, synthesize counts, mutation audit log) are collected best-effort by the backend stats middleware; collection failures never fail requests.

---

## 8. Data Types Reference

### Core Types

| Type | Key Fields |
|------|-----------|
| `VoiceProfile` | id, name, audio_url, original_audio_url, cloned_preview_url, qwen_voice_id, mimo_voice_id, clone_engine (`qwen`/`mimo`/`voxcpm`), description, prompt_text, avatar |
| `Segment` | id, text, ssml, params (SegmentEngineParams), status, emotion, role_id, role_snapshot, segment_kind, prosody_marks, voice_ref, overrides, generated_voice_id, duration_sec |
| `Chapter` | id, name, engine, voice params, segments[], default_params, split_config, original_text, design_title |
| `SegmentedProject` | id, name, chapters[], source_document, default_narrator_role_id, default_narrator_snapshot, remotion_project_path, configs (JSON: description / export_directory / split_voice_mode / …) |
| `Role` | id, name, avatar, description, role_kind (`narrator`/`cast`), default_engine, default_voice, default_engine_params, favorite_styles |
| `EmotionType` | happy, sad, angry, calm, neutral, excited |
| `SegmentStatus` | idle, queued, pending, ready, failed |

### Segment Engine Params

```typescript
interface SegmentEngineParams {
  engine: 'cosyvoice' | 'edge_tts' | 'mimo_tts' | 'voxcpm';
  // CosyVoice
  voice_id?, instruction?, speed?, volume?, pitch?, language?, enable_ssml?, enable_markdown_filter?;
  // Edge-TTS
  edge_voice?, edge_rate?, edge_volume?;
  // MiMo-TTS
  mimo_mode? ('preset'|'voiceclone'|'voicedesign'), mimo_preset_voice?, mimo_clone_voice_id?, mimo_instruction?, mimo_voice_description?;
  // VoxCPM
  voxcpm_mode? ('tts'|'design'|'clone'|'ultimate'), voice_id?, voxcpm_voice_description?, voxcpm_style_control?, voxcpm_prompt_text?, voxcpm_cfg_value?, voxcpm_inference_timesteps?;
  // Clone input method
  input_method?: 'record' | 'upload' | 'url';
}
```

---

## 9. Environment Configuration

See `docs/ENV.md` for the full list of 27 environment variables. Key variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `sqlite:///./voice_clone.db` | Backend database |
| `QWEN_API_KEY` | — | Qwen CosyVoice API key |
| `MIMO_API_KEY` | — | MiMo TTS API key |
| `MIMO_BASE_URL` | `https://api.xiaomimimo.com/v1` | MiMo API endpoint |
| `LLM_API_KEY` | Falls back to `MIMO_API_KEY` | LLM correction key |
| `LLM_MODEL` | `mimo-v2.5-pro` | LLM model |
| `FUNASR_MODEL` | `paraformer-zh` | FunASR model |
| `FUNASR_DEVICE` | Auto-detect | cuda > mps > cpu |
| `VOXCPM_MODEL_PATH` | `openbmb/VoxCPM2` | VoxCPM HuggingFace model |
| `VOXCPM_DEVICE` | `auto` | VoxCPM compute device |

---

## 10. API Endpoints Summary

See `docs/api-reference.md` for full request/response documentation.

| Group | Endpoint | Method | Purpose |
|-------|----------|--------|---------|
| Clone | `/api/clone/upload` | POST | Upload audio file |
| Clone | `/api/clone/upload-from-url` | POST | Download audio from URL |
| Clone | `/api/clone/create-clone` | POST | CosyVoice register |
| Clone | `/api/clone/create-clone-mimo` | POST | MiMo mark for clone |
| Clone | `/api/clone/create-clone-voxcpm` | POST | VoxCPM mark for clone |
| Clone | `/api/clone/create-from-design` | POST | Create VoiceProfile from design |
| Clone | `/api/clone/{id}/preview-audio` | PATCH | Save clone preview audio |
| Clone | `/api/clone/list` | GET | List voices |
| TTS | `/api/tts/synthesize` | POST | CosyVoice/Edge synthesis |
| TTS | `/api/tts/voices` | GET | Cloned voices |
| TTS | `/api/tts/edge-voices` | GET | Edge-TTS voices |
| MiMo | `/api/mimo-tts/preset` | POST | Preset voice synthesis |
| MiMo | `/api/mimo-tts/voicedesign` | POST | Text-described voice (`optimize_text_preview=false`) |
| MiMo | `/api/mimo-tts/voiceclone` | POST | Clone synthesis |
| VoxCPM | `/api/voxcpm/tts` | POST | Basic TTS |
| VoxCPM | `/api/voxcpm/design` | POST | Voice design |
| VoxCPM | `/api/voxcpm/clone` | POST | Controllable clone |
| VoxCPM | `/api/voxcpm/ultimate-clone` | POST | Ultimate clone |
| Split | `/api/text-split/rule` | POST | Rule-based split |
| Split | `/api/text-split/llm` | POST | LLM semantic split |
| STT | `/api/speech-to-text/transcribe` | POST | Single transcription |
| LLM | `/api/subtitle-llm/correct` | POST | Subtitle correction |
| LLM | `/api/subtitle-llm/translate` | POST | Bilingual translation |
| Roles | `/api/roles` | CRUD | Role management |
| Projects | `/api/segmented-projects` | CRUD | Project management |

---

## 11. Backend Storage

When `storageMode = backend`:

- Three tables: `segmented_projects` / `segmented_project_chapters` / `segmented_project_segments`
- Audio stored in `uploads/segmented/{project_id}/`
- Backend is authoritative; IndexedDB is draft cache with `base_updated_at` conflict detection (2000ms tolerance)
- Migration from IndexedDB prompted when switching to backend mode
- Audio transcoded via ffmpeg to mp3

---

## 12. E2E Test Coverage

Each feature section is covered by automated E2E tests under `tests/e2e/specs/`.
Tests verify UI state before/after operations and validate backend data (including JSON field-level checks).

### 12.1 Project CRUD (§4.1, §4.2)

| Test | Feature Section | What It Verifies |
|------|----------------|------------------|
| `project-crud.spec.ts` — creates a new project from the hub | §4.1 Project Structure, §4.2 ProjectHub | New project card appears, backend has valid chapters |
| `project-crud.spec.ts` — renames a project | §4.1 Project Structure, §4.2 ProjectHub | Name updates in UI and backend, chapters preserved |
| `project-crud.spec.ts` — deletes a project with confirmation | §4.1 Project Structure, §4.2 ProjectHub | Project removed from UI and backend after confirm |

### 12.2 Project Pages (§3, §4.2, §4.4, §4.6)

| Test | Feature Section | What It Verifies |
|------|----------------|------------------|
| `project-pages.spec.ts` — Voice Design page | §3.1 Page Structure, §3.5 Voice Profile Cards | Page title, voice profile grid renders |
| `project-pages.spec.ts` — Role Management | §4.6 Voices — Role Management | Role list with 小明/小红 roles visible |
| `project-pages.spec.ts` — Global Role Library | §4.6 Voices — Role Library | Role library panel opens from project |
| `project-pages.spec.ts` — Overview | §4.2 ProjectShell (Overview) | Chapter list, narrator info, segment counts |
| `project-pages.spec.ts` — Studio | §4.4 Studio — Segmented Editor | Segment rows render, batch controls visible |
| `project-pages.spec.ts` — Voice Lock Icons | §4.4 Per-Segment Voice Source | Lock/unlock icons on segment rows |

### 12.3 Studio Operations (§4.4)

| Test | Feature Section | What It Verifies |
|------|----------------|------------------|
| `studio-segment-operations.spec.ts` — generate audio | §4.4 Segment Lifecycle | idle → queued → pending → ready transition |
| `studio-segment-operations.spec.ts` — toggle voice lock | §4.4 Per-Segment Voice Source | chapter ↔ custom source switch |
| `studio-segment-operations.spec.ts` — delete segment | §4.4 Per-Segment features | Segment removed, count decreased |
| `studio-segment-operations.spec.ts` — merge segments | §4.4 Per-Segment features | Two segments merged into one |
| `studio-text-split.spec.ts` — rule mode split | §4.4 Text Input & Split (Rule) | Text split by punctuation delimiters |
| `studio-text-split.spec.ts` — LLM smart split | §4.4 Text Input & Split (LLM) | Semantic splitting with emotion analysis |
| `studio-text-split.spec.ts` — re-split | §4.4 Text Input & Split | Existing segments cleaned up before re-split |
| `studio-narrator-voice.spec.ts` — engine selector | §4.4 Narrator Voice Sidebar | Engine options (Edge/CosyVoice/MiMo/VoxCPM) |
| `studio-narrator-voice.spec.ts` — apply voice | §4.4 Narrator Voice Sidebar (Apply) | Chapter.voice updated, stale segments flagged |
| `studio-batch-export.spec.ts` — batch synthesize | §4.4 Batch Operations (Generate All) | All idle/failed segments queued |
| `studio-batch-export.spec.ts` — export dialog | §4.4 Batch Operations (Export) | WAV/JSON/SRT export options shown |

### 12.4 Voice Role Flows (§3.3, §3.4, §4.6, §4.7)

| Test | Feature Section | What It Verifies |
|------|----------------|------------------|
| `voice-role-flows.spec.ts` — MiMo preset role | §4.6 Role Management, §4.7 Voice Selection | MiMo preset voice → role created → preview plays |
| `voice-role-flows.spec.ts` — design new voice role | §4.6 Role Management, §3.4 Voice Design Flow | Text description → preview → save → role created |
| `voice-role-flows.spec.ts` — edit existing role | §4.6 Role Management, §3.3 Clone Flow | Edit role → preview audio renders correctly |
| `dialogue-prosody.spec.ts` — dialogue view | §4.6 Role Management, §4.4 Segment Kind | Role created, dialogue segment with role assignment |

### 12.5 Transcription Hub (§5)

| Test | Feature Section | What It Verifies |
|------|----------------|------------------|
| `transcription.spec.ts` — upload area | §5.1 Layout, §5.4 Input Methods | Two-column layout, AudioDropzone visible |
| `transcription.spec.ts` — engine config | §5.2 Engine Support, §5.3 Parameters | Whisper/FunASR options, model size selector |
