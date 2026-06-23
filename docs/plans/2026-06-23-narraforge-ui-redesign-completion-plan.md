# NarraForge UI Redesign Completion Plan

> **For Hermes:** Use test-driven-development for every behavior change. Do not report "done" until all completion gates pass.

**Goal:** Finish the project-based UI redesign as a complete, usable workflow, including missing small features and cross-surface linking, not just visual shells.

**Architecture:** Keep Global Project Hub separate from Project Workspace. Project data remains in `SegmentedProject` storage through existing frontend/backend storage adapters. Project surfaces share one active project + active chapter state through `TTSSynthesis` / `useSegmentedProject`; Library owns chapter text, Studio owns segmented production, Voices owns project voice roles.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, Testing Library, CSS Modules, FastAPI storage APIs through existing services.

---

## Completion Gates

A task is not complete unless all applicable checks pass:

- Focused RED test fails before implementation.
- Focused GREEN test passes after implementation.
- `cd frontend && npx vitest run` passes.
- `cd frontend && npx tsc --noEmit` passes.
- Vite transform curl returns 200 for touched TSX/CSS/test files.
- Headless browser smoke covers Global Hub, Project Overview, Library, Studio, Voices, Settings, Subtitles, Voice Design.
- Browser smoke must verify no duplicate Studio chrome: legacy title 0, list/dialogue switch 1 each, play/export 1 each.
- Worktree clean after commit.

Known existing whole-repo `npm run lint` debt is tracked separately; touched files should pass targeted eslint where practical.

---

## Phase 1 — Restore Global Project Hub Management

### Task 1.1: Add Project Hub delete affordance

**Objective:** Project deletion must be visible on every project card without opening the project.

**Files:**
- Modify: `frontend/src/components/ProjectHub/ProjectHub.tsx`
- Modify: `frontend/src/components/ProjectHub/ProjectHub.module.css`
- Test: `frontend/src/components/ProjectHub/ProjectHub.test.tsx`
- Modify: `frontend/src/App.tsx`
- Test: `frontend/src/__tests__/App.test.tsx`

**Behavior:**
- Project cards keep click-to-open behavior.
- Each project card has a clearly visible `删除项目` action.
- Clicking delete does not open the project card.
- The hub asks for confirmation using an in-app confirm UI or native `window.confirm` as first pass.
- Confirmed delete calls storage delete, refreshes hub list, and remains in global hub.
- Cancelled delete does nothing.
- If backend storage mode is active, use the same active storage adapter selected by App.

**TDD:**
- RED: ProjectHub test asserts delete button exists and stopPropagation prevents `onOpenProject`.
- RED: App test asserts delete calls `indexedDBStorage.deleteProject(projectId)` and project disappears from hub.
- GREEN: Add `onDeleteProject(projectId)` prop and App handler.

### Task 1.2: Add Project Hub quick rename

**Objective:** Users can rename projects from the global hub without entering Settings.

**Files:**
- Modify: `ProjectHub.tsx/.module.css`
- Modify: `App.tsx`
- Test: `ProjectHub.test.tsx`, `App.test.tsx`

**Behavior:**
- Add `重命名` action on card.
- Rename opens compact inline input or prompt.
- Saving updates project name through storage and refreshes hub list.
- Empty name is rejected and keeps old value.

### Task 1.3: Hub card action semantics

**Objective:** Avoid nested button accessibility conflicts on project cards.

**Files:**
- Modify: `ProjectHub.tsx`
- Test: `ProjectHub.test.tsx`

**Behavior:**
- Whole card should not be a `<button>` if it contains delete/rename buttons.
- Use `<article>` + explicit `打开项目` button or clickable non-button card region.
- Internal actions must be separately keyboard accessible.

---

## Phase 2 — Complete Library Chapter Management

### Task 2.1: Inline chapter rename from Library overview

**Objective:** Chapter name editing must be available directly on chapter cards, not only inside immersive editor.

**Files:**
- Modify: `frontend/src/components/ProjectLibrary/ProjectLibrary.tsx`
- Modify: `ProjectLibrary.module.css`
- Test: `ProjectLibrary.test.tsx`

**Behavior:**
- Each chapter card has `重命名章节` or editable title control.
- Save dispatches `RENAME_CHAPTER` for that chapter.
- Empty name is rejected or restored to previous name.
- Rename does not accidentally select/open the chapter.

### Task 2.2: Delete chapter from Library overview/editor

**Objective:** Chapter deletion must be discoverable in Library, not only in the old Studio toolbar.

**Files:**
- Modify: `ProjectLibrary.tsx/.module.css`
- Modify: `TTSSynthesis.tsx`
- Test: `ProjectLibrary.test.tsx`, focused `TTSSynthesis` integration test if needed.

**Behavior:**
- Add `删除章节` action in card and chapter editor inspector.
- Confirm before deleting.
- Deleting active chapter selects a remaining chapter.
- Last chapter cannot be deleted; show disabled state or toast.

### Task 2.3: Create chapter with user-provided name

**Objective:** New chapters should not only be generic sequential names.

**Files:**
- Modify: `ProjectLibrary.tsx`
- Modify: `TTSSynthesis.tsx`
- Test: `ProjectLibrary.test.tsx`

**Behavior:**
- `新建章节` prompts for a chapter name or opens inline creation row.
- Blank name falls back to `新章节 N`.
- Created chapter becomes active and opens editor or remains selected visibly.

### Task 2.4: Chapter design title editing

**Objective:** Library inspector `设计标题` should be editable, because it is displayed as chapter metadata.

**Files:**
- Modify: `ProjectLibrary.tsx`
- Modify: `useSegmentedProject.ts` only if reducer lacks needed meta action.
- Test: `ProjectLibrary.test.tsx`, `useSegmentedProject.test.ts`

**Behavior:**
- Editor has `设计标题` input.
- It persists to `chapter.design_title` through `SET_CHAPTER_META` or new `SET_CHAPTER_META_BY_ID` action.

---

## Phase 3 — Fix Library ↔ Studio Linking

### Task 3.1: Enter Studio from Library selects the exact chapter

**Objective:** Clicking `进入工作室` from any Library card/editor must open Studio with that chapter active.

**Files:**
- Modify: `TTSSynthesis.tsx`
- Test: `TTSSynthesis` integration test or `ProjectLibrary.test.tsx` callback assertion.

**Behavior:**
- `onEnterStudio(chapterId)` dispatches `SELECT_CHAPTER` before `setProjectSection('studio')`.
- Studio chapter select shows the chosen chapter.
- Breadcrumb meta updates to selected chapter.

### Task 3.2: Library full text feeds Studio split input

**Objective:** Text edited in Library must be the default text source in Studio smart split.

**Files:**
- Modify: `TTSSynthesis.tsx`
- Modify: `TextInputPanel.tsx` only if needed.
- Test: new `TTSSynthesis.libraryStudioLink.test.tsx`

**Behavior:**
- Editing chapter full text updates `chapter.original_text`.
- Opening Studio for that chapter pre-fills split text with `chapter.original_text` when no local unsaved split draft exists.
- Smart split operates on the Library text.

### Task 3.3: Studio chapter select preserves Library text and settings

**Objective:** Switching chapters in Studio should restore that chapter's Library text, model settings, and split config.

**Files:**
- Modify: `TTSSynthesis.tsx`
- Test: `TTSSynthesis.libraryStudioLink.test.tsx`

**Behavior:**
- Selecting chapter B in Studio restores B original text and chapter-level voice settings.
- Returning to chapter A restores A original text and settings.

### Task 3.4: Detect stale segments after Library text edit

**Objective:** If Library text changes after segments were generated/split, Studio should indicate that segments may be stale.

**Files:**
- Modify: `ProjectLibrary.tsx` and/or `TTSSynthesis.tsx`
- Test: component test.

**Behavior:**
- If `chapter.original_text` differs from joined segment text, show a visible `文本已更新，建议重新拆分` hint in Studio and/or Library inspector.
- No automatic deletion of generated audio.

---

## Phase 4 — Finish Project Settings and Export Defaults

### Task 4.1: Editable project description/type/language

**Objective:** Settings should manage more than project name and Remotion path.

**Files:**
- Modify: `types/index.ts` if fields already missing.
- Modify: `useSegmentedProject.ts`
- Modify: `ProjectSettings.tsx/.module.css`
- Test: `ProjectSettings.test.tsx`, reducer tests.

**Behavior:**
- Project description, project type, default language can be edited and persisted.
- Defaults appear in Overview.

### Task 4.2: Export directory and naming rule

**Objective:** Settings export rule should be editable, not static text.

**Files:** same as Task 4.1

**Behavior:**
- Edit default export directory.
- Edit naming template, e.g. `{project}-{chapter}-{date}`.
- Studio export dialog reads these defaults if supported; otherwise Settings clearly labels them as project defaults for upcoming exports.

---

## Phase 5 — Complete Voices / Role Usability Gaps

### Task 5.1: Draft preview from Voice Role Editor

**Objective:** `生成试听` in the role editor must synthesize the draft engine/voice/params before saving.

**Files:**
- Modify: `ProjectVoices.tsx`
- Test: `ProjectVoices.test.tsx`

**Behavior:**
- Clicking `生成试听` calls preview with draft params.
- Loading state appears on editor, not only role cards.
- Failure shows visible error/toast path.

### Task 5.2: Role kind source of truth migration guard

**Objective:** Until backend has `role_kind`, make heuristic explicit and test all expected names/descriptions.

**Files:**
- Create or modify: `frontend/src/services/voiceRoleKind.ts`
- Modify: `ProjectVoices.tsx`, `ChatSegmentView.tsx`, `SegmentList.tsx`, `VoiceStudioLayout.tsx`
- Test: `voiceRoleKind.test.ts`

**Behavior:**
- One shared helper classifies Narrator/Cast.
- Tests cover English/Chinese names and descriptions.

---

## Phase 6 — Global Subtitles Deep Workflow

### Task 6.1: Multi-file queue UI

**Objective:** Subtitles page must support adding multiple audio/video files, order editing, and removal.

**Files:**
- Modify: `SpeechToText.tsx/.module.css`
- Test: `SpeechToText.redesign.test.tsx` or new test.

**Behavior:**
- Add files to queue.
- Reorder up/down.
- Remove item.
- Display file order and duration placeholder.

### Task 6.2: Boundary map and unified export model

**Objective:** Recognition result should expose SRT/TXT/JSON outputs with per-file boundaries.

**Files:**
- Modify/add service utilities under `frontend/src/services/`.
- Test: utility tests.

**Behavior:**
- Generate boundary map `{fileId, filename, startSec, endSec}`.
- JSON export includes boundaries and transcript segments.

### Task 6.3: Video input extraction path documentation/guard

**Objective:** UI should explain video inputs extract audio first and show unsupported backend state clearly.

**Files:** `SpeechToText.tsx`

**Behavior:**
- Accept video file extensions in queue UI.
- If backend extraction is not wired, show explicit queued/unsupported state instead of silent failure.

---

## Phase 7 — Global Voice Design Deep Workflow

### Task 7.1: Voice Profile Library redesign

**Objective:** Voice Design should have a visible profile-library surface, not only legacy clone list.

**Files:**
- Modify: `VoiceClone.tsx/.module.css`
- Modify: `VoiceList.tsx` if needed.
- Test: `VoiceClone.redesign.test.tsx`, `VoiceClone.test.tsx`

**Behavior:**
- Show Voice Profile Library section with cloned/designed/tuned profile categories.
- Existing clone list is nested as cloned profile list.
- No `即将推出` placeholder wording.

### Task 7.2: Design/Tune tab usable form

**Objective:** The Voice Design tab must collect design prompt/style params and show clear output path, even if generation endpoint is partial.

**Files:** `VoiceClone.tsx`

**Behavior:**
- Natural-language voice prompt field.
- Engine-specific parameter controls.
- Save profile or explicit `生成音色` action if endpoint exists; otherwise disabled with precise requirement text.

---

## Phase 8 — i18n Completion for New UI

### Task 8.1: Move new UI strings to i18n dictionary

**Objective:** New project shell/hub/library/studio/voices/settings strings should use `frontend/src/i18n`.

**Files:**
- Modify: `frontend/src/i18n/zh-CN.ts`
- Modify: `frontend/src/i18n/en-US.ts`
- Modify: all new UI components.
- Test: `i18n.test.ts`, component smoke tests.

**Behavior:**
- No hardcoded long-form display strings in newly added redesign components except test-only labels and model/provider names.
- `zh-CN` and `en-US` keys stay aligned.

---

## Phase 9 — Backend Schema Follow-up

### Task 9.1: Add `role_kind` to Role schema/API

**Objective:** Replace frontend name/description heuristic with explicit backend field.

**Files:**
- Backend model/schema/API role files under `backend/app/`.
- Frontend role types and role API service.
- Tests: backend role API tests and frontend role kind tests.

**Behavior:**
- `role_kind: narrator | cast` persisted.
- Existing roles migrate safely using current heuristic once.
- Frontend sends/reads role_kind.

---

## Phase 10 — Final Review and Release

### Task 10.1: End-to-end browser smoke script

**Objective:** Codify the current manual smoke into a reusable script.

**Files:**
- Create: `tests/e2e/specs/ui-redesign-workflow.spec.ts` or `.artifacts` script if not committing E2E yet.

**Behavior:**
- Hub create/open/delete project.
- Library create/rename/edit chapter and enter Studio.
- Studio split text, switch list/dialogue, assign role.
- Voices create/preview role.
- Settings edit Remotion path.
- Subtitles and Voice Design global pages load.

### Task 10.2: Full verification and PR prep

**Commands:**
- `cd frontend && npx vitest run`
- `cd frontend && npx tsc --noEmit`
- targeted `eslint` for changed files
- Vite transform curl for changed TSX/CSS/tests
- headless browser smoke
- `git status --short --branch`

**Deliverable:**
- Commit all changes.
- Summarize completed features, verification, and remaining intentional product follow-ups only if any are explicitly out of scope.
