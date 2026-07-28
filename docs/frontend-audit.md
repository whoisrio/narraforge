# NarraForge — Frontend Audit Report

**Version**: 1.0
**Date**: 2026-07-28
**Status**: Current

---

## 1. Overview

This document is a static audit of `frontend/src` (~27k lines of TS/TSX plus 82 CSS Modules) covering three areas: i18n coverage, layout/styling consistency, and interaction/UX patterns.
Every finding cites concrete file and line evidence.
Findings are grouped by severity: **High** (defects or large-scale inconsistency), **Medium** (worth fixing, limited impact), **Low** (polish).

**Audit scope**: `frontend/src/pages`, `frontend/src/components`, `frontend/src/hooks`, `frontend/src/i18n`, `frontend/src/styles`.
**Method**: static code review only; runtime interaction behavior was not verified in a browser.

---

## 2. i18n: Solid Infrastructure, Broken Execution

The language packs themselves are healthy: `zh-CN.ts` and `en-US.ts` each hold 1260 leaf keys with 100% structural symmetry, enforced at compile time via `Messages = WidenStrings<typeof zhCN>` (`en-US.ts:1`).
No untranslated Chinese remains in the English pack.
The problems are all in how components consume (or bypass) the infrastructure.

### 2.1 High

| # | Finding | Evidence |
|---|---------|----------|
| I1 | **28 `t()` keys referenced in source do not exist in the language packs.** At runtime the raw key string (e.g. `tts.playFailed`) is rendered, including in confirmation dialogs for destructive operations. Most are wrong paths to synonyms that exist elsewhere (e.g. `projectLibrary.newChapter` exists but components reference `tts.newChapter`). | `pages/TTSSynthesis.tsx` (17 keys: `:411`, `:441`, `:572`, `:652-653`, `:691`, `:834`, `:1172`, `:1227`, `:1268`, `:1273`, `:1621`, `:1625`), `RoleSyncPrompt.tsx:17,22`, `SegmentRow.tsx:530,539`, `ProjectOverview.tsx:160`, `ProjectHub.tsx:91`, `ProjectLibrary.tsx:475`, `VoiceClone.tsx:469`, `ProjectVoices.tsx:782,860` |
| I2 | **The Workflow module is not wired to i18n.** 7 of 8 components under `components/Workflow/` hardcode Chinese (only `ReviewEditor.tsx` uses `useTranslation`). `GlobalControlBar.tsx` and `SynthesisHistory.tsx` are also fully hardcoded. ~90+ lines of UI copy; English users see a largely Chinese UI. | `WorkflowDrawer.tsx:195,218-231,249,252`, `SynthesisHistory.tsx:31-34,95-98,118-182`, `GlobalControlBar.tsx:72-218` |
| I3 | **9 files import the module-level `t`, which is pinned to zh-CN and never reacts to locale switches.** Module-level constants evaluated with it (e.g. tab labels) never update on language change. | `MiMoTTSPanel.tsx:12,42-43`, `ProjectVoices.tsx:12`, `SSMLToolbar.tsx:13`, `NarrationBlock.tsx:3`, `TTSSynthesis.tsx:2` (`staticT`), `useSegmentedProject.ts:2`, `voiceRoleDefaults.ts:2`, `voiceDesignPreview.ts:3`, `voiceRolePreview.ts:3` |
| I4 | **Default locale is inconsistent in three places.** Provider defaults to `en-US`, module-level `t` is fixed at `zh-CN`, and the no-Provider hook fallback is `zh-CN`. | `i18n/index.tsx:69,85,113` |

### 2.2 Medium

| # | Finding | Evidence |
|---|---------|----------|
| I5 | **225 pack keys have no source reference** (`workflow` group alone holds 84). Copy was written ahead of wiring; the two sides drift in both directions. | `zh-CN.ts` `workflow`/`segmentEdit`/`segment`/`subtitles` groups |
| I6 | **120 groups of synonymous duplicate keys**: `取消` ×11, `删除` ×7, `加载中...` ×5. No `common.*` convergence convention. | `zh-CN.ts` passim |
| I7 | **25 hardcoded Chinese `placeholder`/`title`/`aria-label` attributes** — accessibility copy stays Chinese in the English UI. | e.g. `WorkflowDrawer.tsx:249,252`, `SynthesisHistory.tsx:118-182` |

### 2.3 Low

- `i18n/i18n.test.ts` has no static check that keys referenced in source exist in the packs (this is how I1 shipped), and no zh/en symmetry or `{var}` placeholder-consistency assertions.
- `SourceLibrary.tsx:35-89` mock demo data is Chinese-only.
- 28 English values identical to Chinese are mostly brand/technical terms (acceptable), but a few (e.g. `voiceDesign.projectRoleReady`) need an intent check.

---

## 3. Layout & Styling: Token System Circumvented

`styles/variables.css` (143 lines) defines a competent token set: color/surface/text/border, 7 shadow steps, 7 spacing steps, 8 font-size steps, 5 radii, 7 z-index levels, component sizes, 6 emotion colors.
The system is fine; execution bypasses it at scale.

### 3.1 High

| # | Finding | Evidence |
|---|---------|----------|
| L1 | **Shared UI kit is heavily underused.** `components/ui/` ships 11 components via the barrel (`ui/index.ts`), but the barrel has only 4 importers (`TTSControls`, `ModelSelector`, `VoiceList`, `AudioRecorder` — all legacy modules), and `ui/Modal` has exactly 2 users (`VoiceList` via the barrel, the dead `pages/SourceLibrary.tsx` directly). Newer modules (SegmentedTTS / ProjectLibrary / Workflow / ProjectVoices) ignore the kit entirely: **14 components hand-roll their own overlay** with divergent backdrop colors, z-indexes, and centering, and native `<button>` appears 353 times with styles rewritten per module. `ConfirmDialog` exists but is not exported from the barrel at all. | `ui/index.ts:1-29`; `ExportDialog.module.css:2`, `SegmentEditDrawer`, `ChapterSplitModal`, `ApplyAnalysisDialog`, `StageDetailModal`, `AdjustAudioDialog`, `SSMLToolbar`, etc. |
| L2 | **Hardcoded values dwarf token usage** across 82 CSS Modules: font-size 544 hardcoded lines vs 242 token lines; `rgba()` written directly 376 lines; hex colors 115 lines in 17 files; z-index hardcoded 24 times including 1000/9999 which exceed the token ceiling of 700. A "shadow scale" of non-token sizes (`13px` ×86, `11px` ×86, `10px` ×77; token minimum is 12px) proves the declared and actual visual systems have diverged. | Worst offenders: `SegmentRow.module.css` (34), `ProjectLibrary.module.css` (32), `SourceLibrary.module.css` (28), `Landing.module.css` (26); z-index abuse in `ConfirmDialog.module.css`, `ApplyAnalysisDialog.module.css`, `VoiceStudioLayout.module.css` |
| L3 | **Emotion colors are duplicated into TS.** Six `--emo-*` hex values are hard-copied into a TS array, so changing the CSS token silently does nothing. | `SegmentEditPanel.tsx:39-44` |
| L4 | **Zero dark-theme support.** No `prefers-color-scheme`/`data-theme` anywhere, and 376 lines of hardcoded light rgba values make a future dark theme expensive. | whole `frontend/src` |

### 3.2 Medium

| # | Finding | Evidence |
|---|---------|----------|
| L5 | `App.css` (184 lines) is dead code — no imports anywhere. | `App.tsx:19` only imports `App.module.css` |
| L6 | `AppShell` and `ProjectShell` skeletons are ~50% duplicated (sidebar/rail, collapse button, nav item styles) — two parallel implementations that will drift. | `AppShell.module.css:83-98,174-187` vs `ProjectShell.module.css:15-31,372-388` |
| L7 | `ProjectShell` reserves `padding-right: 312px` for the right panel, but the 1100px breakpoint resets only `padding-left` — narrow screens get squeezed/overflow when the panel opens. | `ProjectShell.module.css:403,453-467` |
| L8 | Header height magic numbers in three flavors (56px / 60px fallback / 76px) — any header change breaks all three differently. | `SourceLibrary.module.css:3,10,156`, `ProjectLibrary.module.css:4`, `ProjectShell.module.css:7` |
| L9 | Breakpoints span seven values (640/720/768/900/1024/1100/1200) with no convention. | 33 `@media` blocks |
| L10 | 165 inline styles across 34 tsx files, including static card styles copy-pasted three times. | `ProjectVoices.tsx` (52, e.g. `:824,891,920`), `VoiceList.tsx` (17), `Modal.tsx:87`, `ExportDialog.tsx:182` |

### 3.3 Low

- Redundant `var(--token, #fallback)` fallbacks (e.g. `ScriptAnalysisModal.module.css`, 34 lines) silently drift once stale — the `60px` fossil in L8 is exactly this failure mode.
- `word-break`/`overflow-wrap` appears only 8 times vs 96 `white-space: nowrap` (only 43 with `text-overflow: ellipsis`).
- Only `100vh` is used (12 places), no `100dvh`.
- Non-token `font-weight` values (650/750/850/900) appear, e.g. `ProjectShell.module.css:71,82,96`.
- A few CSS files use compressed single-line multi-declaration style, inconsistent with the rest of the repo.

### 3.4 Mobile navigation gap (deprioritized)

At `@media (max-width: 900px)` the AppShell sidebar is `display: none` (`AppShell.module.css:200-213`) with no hamburger/bottom-tab replacement, so global navigation disappears on mobile.
**Decision (2026-07-28): deprioritized** — the product is desktop-first; tracked here as a known gap, not scheduled.

---

## 4. Interaction & UX: Fragmented Feedback and Confirmation Channels

### 4.1 High

| # | Finding | Evidence |
|---|---------|----------|
| U1 | **Destructive-action confirmation uses three parallel mechanisms**: native `alert/confirm` (~19 call sites in 14 files), `ConfirmDialog` (13 uses inside TTSSynthesis), and `ui/Modal`. | `App.tsx:119,145,156`, `ModelSelector.tsx:61`, `TranscriptionHistory.tsx:51`, `RoleLibraryPanel.tsx:102`, `SegmentEditDrawer.tsx:36`, `ExportDialog.tsx:83`, `WorkflowDrawer.tsx:195,200`, `ProjectShell.tsx:122` |
| U2 | **No unified error channel.** Two hand-written toasts (`TTSSynthesis.tsx:353-355`, `ModelConfig.tsx:38-40`) whose `setTimeout` ids are not stored (rapid triggers clear each other; no cleanup on unmount); failures surface as toast / `alert()` / inline message / **silent swallow**. Silent swallows: `VoiceList.tsx:123-124` (delete fails, dialog already closed, user believes it succeeded), `WorkflowDrawer.tsx:208-210`, `ProjectVoices.tsx:310-311` (`.catch(() => {})`), `App.tsx:115-139` (three handlers without try/catch). 56 `console.error/warn` across 19 files are often the only "handling". | see left |
| U3 | **Only 1 of ~12 hand-rolled overlays supports Esc** (`ScriptAnalysisModal.tsx:17`). `ui/Modal.tsx:12-21` has no Esc, no focus trap, no focus return; `ConfirmDialog` has `role="alertdialog"` but no Esc/focus management. `WorkflowDrawer` closes only via the ✕ button. | `ui/Modal.tsx:83`, `ui/ConfirmDialog.tsx:28-29` |
| U4 | **No URL routing** (no react-router). Navigation is four `useState`s in `App.tsx:47-51`; a refresh loses project/tab context and deep links are impossible. Switching projects remounts TTSSynthesis via `key` (`App.tsx:214`), destroying unsaved UI state. | `App.tsx:47-51,214,221-229` |
| U5 | **Two real copy bugs**: on sync *failure*, `ProjectShell.tsx:130,145` alerts `t('sync.syncing')` — telling the user "syncing…" when the operation failed — and the error detail is discarded by `catch {}`. | `ProjectShell.tsx:130,145`, `zh-CN.ts:213` |

### 4.2 Medium

| # | Finding | Evidence |
|---|---------|----------|
| U6 | Inconsistent double-submit protection: `ProjectHub.tsx:90-96` create-project has no busy lock (double-click creates two projects); `TTSSynthesis.tsx:1607` batch-synthesize has no `disabled`, and repeat clicks are silently ignored by an early return (`:1089`) with zero feedback. | see left |
| U7 | Clickable divs without keyboard accessibility (collapse toggles, tree nodes, progress-bar seek) — no role/tabIndex/key handlers. Contrast with the correct pattern at `ProjectVoices.tsx:1209-1215`. | `VoxCPMPanel.tsx:306`, `VoiceClone.tsx:374`, `TTSSynthesis.tsx:1474,1502`, `SSMLToolbar.tsx:328`, `PlaybackBar.tsx:96` |
| U8 | God components: `TTSSynthesis.tsx` (1840 lines, 44 `useState`), `ProjectVoices.tsx` (1397 lines, 25 `useState`, 14 try/catch), `SegmentRow.tsx` (~30 props drilled through three layers). | see left |

### 4.3 Low

- Dead code: `pages/SourceLibrary.tsx` (537 lines) and `components/TTSSynthesis/SynthesisHistory.tsx` have no importers.
  The dead page also transitively strands four components that only it imports: `GenerateNarrationModal`, `NarrationFullView`, `SourceUploadZone`, `ScriptAnalysisModal`.
  Note the dead page's "旁白文档" panel is a **non-persisted mock feature**: `MOCK_NARRATIONS` + `useState(MOCK_NARRATIONS)` + `setNarrationsByProject` are all in-memory (`pages/SourceLibrary.tsx:56,101,169`) and `GenerateNarrationModal` calls no backend — if the page is ever revived instead of deleted, this panel needs real backend wiring first (the live 源文档 functionality is in `ProjectLibrary`/`SourceDocumentView.tsx`).
- `SegmentRow.tsx:72-84` renders a fake waveform hashed from the id — misleading.
- `ConfirmDialog` is not exported from `ui/index.ts`.
- Overlay click-outside closes long forms without confirmation (`ExportDialog.tsx:170`).
- Toasts lack `role="status"`/`aria-live` (`TTSSynthesis.tsx:1800`, `ModelConfig.tsx:268`).
- Hardcoded Chinese inside `console.error` messages (`VoiceClone.tsx:92`), inconsistent with other English logs.

---

## 5. Remediation Roadmap

Ordered by priority; each phase is independently shippable.
Mobile navigation (§3.4) is intentionally excluded per the deprioritization decision.

### P0 — Real bugs and guardrails (small, fast)

1. Fix the wrong `sync.syncing` copy key on failure paths (`ProjectShell.tsx:130,145`); add user-visible failure feedback for the silent swallows (`VoiceList.tsx:123`, `ProjectVoices.tsx:310`, `App.tsx:115-139`).
2. Fix the 28 missing i18n keys (mostly repointing references to existing groups); add a static test in `i18n.test.ts` asserting every literal key referenced in source exists in both packs, plus zh/en symmetry and `{var}` placeholder-consistency assertions.
3. Delete dead code: `App.css`, `pages/SourceLibrary.tsx`, `components/TTSSynthesis/SynthesisHistory.tsx`, and the four transitively dead `components/SourceLibrary/` components (`GenerateNarrationModal`, `NarrationFullView`, `SourceUploadZone`, `ScriptAnalysisModal`).

### P1 — Unified channels (confirmation / toast / overlay)

4. Export `ConfirmDialog` from `ui/index.ts`; add a shared `Toast` (timer cleanup + `aria-live`); replace all ~19 native `alert/confirm` call sites.
5. Add Esc + focus trap + focus return to `ui/Modal`; converge the 14 hand-rolled overlays onto it in batches; route all z-index through tokens.
6. Add double-submit protection: `ProjectHub` create-project busy lock, `TTSSynthesis` batch-synthesize `disabled` state.

### P2 — i18n consolidation

7. Wire the 7 Workflow components + `GlobalControlBar` to i18n, reusing the existing 84 `workflow.*` keys; delete dead keys afterwards.
8. Ban module-level `t` imports in components (ESLint `no-restricted-imports`); convert module-level constants to in-component `useMemo`; unify the three default-locale sources (`localStorage` → browser language → `zh-CN`).
9. Converge high-frequency synonyms (`取消`/`删除`/`保存`/`加载中`) into `common.*`.

### P3 — Styling system (incremental lint fence)

10. Add stylelint rules banning raw hex/rgba, pixel `font-size`, and numeric z-index; fence new code first, then backfill existing files in batches; either add 10/11/13px sizes to the token scale or unify usage onto existing steps.
11. Merge the duplicated AppShell/ProjectShell rail/nav styles; unify header-height calculation behind tokens; fix the narrow-screen `padding-right` reset (L7).

### P4 — Structure and routing (large; spin off as its own initiative)

12. Introduce react-router to sync tab/projectId into the URL; break down the `TTSSynthesis.tsx` god component (confirm dialog, toast, generation queue as hooks); move SegmentRow's global voice parameters to context.

---

## 6. Caveats

This audit is static; runtime behaviors (toast timer races, focus behavior, actual overflow) were not verified in a browser.
After P0/P1 land, run `npm run e2e` to cover the key paths.

---

## 7. Fix Progress

Legend: ⬜ pending · 🔄 in progress · ✅ done (date + verifying test)

| Item | Finding | Fix | Status |
|---|---|---|---|
| F-P0-1 | U5 wrong `sync.syncing` copy on failure | Use correct failure key in `ProjectShell.tsx:130,145` | ✅ 2026-07-28 — added `sync.syncFailed` (zh/en); `ProjectShell.test.tsx` failure-path test |
| F-P0-2 | U2 silent error swallows | User-visible feedback at `VoiceList.tsx:123`, `ProjectVoices.tsx:310`, `App.tsx:115-139` | ✅ 2026-07-28 — `VoiceList.test.tsx`; App.tsx handlers now try/catch + alert (`projectHub.{create,rename,delete}Failed`); WorkflowDrawer rerun failure alerts; ProjectVoices option-list load failure shows a `role="alert"` warning in the editor panel (`projectVoices.voiceOptionsLoadFailed`, regression test in `ProjectVoices.test.tsx`). `vitest run` 332 passed |
| F-P0-3 | I1 28 missing i18n keys | Repoint references + static guard test in `i18n.test.ts` | ✅ 2026-07-28 — 17 keys repointed to existing synonyms, 11 keys added (zh+en symmetric); guard test lives at `src/i18n/missing-keys.test.ts`; also fixed latent `deleteChapterConfirm` interpolation param mismatch (`segCount/audioInfo` → `segments/audioPart`). `vitest run` 331 passed |
| F-P0-4 | Dead code | Delete `App.css`, `pages/SourceLibrary.tsx`, 4 dead `components/SourceLibrary/` components, `SynthesisHistory.tsx` | ✅ 2026-07-28 — `tsc -b` clean, `vitest run` 331 passed |
| B-P0-5 | A3 dead workflow contract | Delete `workflowApi`, `WorkflowRun` types, `ReviewEditor.tsx` | ✅ 2026-07-28 — also removed dead `useWorkflowStream.ts`; `tsc -b` clean, `vitest run` 326 passed |
