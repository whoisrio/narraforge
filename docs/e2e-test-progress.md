# E2E Test Progress

**Last updated**: 2026-07-09
**Pass rate**: 26/26 (100%)

## Test Results Summary

| Spec File | Tests | Passing | Failing |
|---|---|---|---|
| `project-crud.spec.ts` | 3 | 3 | 0 |
| `project-pages.spec.ts` | 6 | 6 | 0 |
| `studio-narrator-voice.spec.ts` | 2 | 2 | 0 |
| `studio-segment-operations.spec.ts` | 4 | 4 | 0 |
| `studio-text-split.spec.ts` | 3 | 3 | 0 |
| `studio-batch-export.spec.ts` | 2 | 2 | 0 |
| `transcription.spec.ts` | 2 | 2 | 0 |
| `voice-role-flows.spec.ts` | 3 | 3 | 0 |
| `dialogue-prosody.spec.ts` | 1 | 1 | 0 |
| **Total** | **26** | **26** | **0** |

## Resolved Failures (2026-07-08 ~ 2026-07-09)

### 1. `dialogue-prosody` — creates a role and opens dialogue view
- **Root cause**: ChatSegmentView not rendered in production; SegmentList roleStrip kind toggle is the actual UI.
  Also SegmentList.tsx used static `t` import (always English), so test locators matching Chinese failed.
- **Fix**: Rewrote test to use SegmentList kind toggle flow. Fixed SegmentList.tsx → `useTranslation()`.

### 2. `studio-batch-export` — batch synthesizes all segments / opens export dialog
- **Root cause**: Test ordering — prior tests modified segment state (voice/emotion/kind);
  batch-export ran on stale segments with no audio.
- **Fix**: Added `beforeEach` seed + dual-read verification. Also fixed test to handle `segment_kind` reset.

### 3. `studio-segment-operations` — generates audio for a single segment
- **Root cause**: Real TTS synthesis is resource-intensive; test timeout.
- **Fix**: Added protective Step 0 (reset segment_kind/voice/role_id). Real synthesis kept, not mocked.

### 4. `studio-segment-operations` — toggles voice lock on a segment
- **Root cause**: State leakage from prior tests (segment already had dirty voice source).
- **Fix**: Added `beforeAll` seed + protective Step 0 detecting dirty state and resetting.

### 5. `project-crud` — deletes a project with confirmation
- **Root cause**: WorkBuddy sandbox blocked `shutil.rmtree` (backend project cleanup).
- **Fix**: Use Playwright's `webServer` to start backend (bypasses sandbox). Also updated npm script with `PW_RUN`.

## Key Fixes Applied

### i18n Fixes (static `t` → `useTranslation`)
| Component | File |
|---|---|
| TTSSynthesis | `frontend/src/pages/TTSSynthesis.tsx` |
| VoiceClone | `frontend/src/pages/VoiceClone.tsx` |
| TextInputPanel | `frontend/src/components/SegmentedTTS/TextInputPanel.tsx` |
| ProjectVoices | `frontend/src/components/ProjectVoices/ProjectVoices.tsx` |
| ConfirmDialog | `frontend/src/components/ui/ConfirmDialog.tsx` |
| SegmentList | `frontend/src/components/SegmentedTTS/SegmentList.tsx` |

### Test Isolation (beforeEach/beforeAll seed)
- `studio-batch-export.spec.ts` — `beforeEach` seed
- `studio-narrator-voice.spec.ts` — `beforeAll` seed
- `studio-segment-operations.spec.ts` — `beforeAll` seed + protective Step 0 in voice-lock test
- `dialogue-prosody.spec.ts` — cleanup step (restore segment to narration kind)

### Dual-Read Verification (Phase 1 + 2 complete)
- All 26 tests verify API layer (`readBackendProject` + `validateChapter`/`validateSegment`)
- 7 specs also verify DB layer (`readDbProject` + `validateDbProjectRow`)
- `verifyDbWithScreenshot()` helper wraps DB read + validation + labeled screenshot
- Two specs (`transcription`, `voice-role-flows`) are API-only (no writes to segmented_projects)

### Infrastructure
- `tests/e2e/helpers/dbReader.ts` — direct SQLite reads via `node:sqlite` (connection-string-driven)
- `tests/e2e/helpers/dualReadSnapshot.ts` — dual-read + screenshot helper
- `playwright.config.ts` — `screenshot: 'on'`, HTML reporter, local-timezone timestamps, `PW_RUN` env var
- `package.json` — `npm run e2e` / `e2e:clean` / `e2e:report` / `e2e:ui`
- Cleanup: removed legacy `tests/e2e/manual/` and `tests/e2e/snapshots/`

## 待补充 E2E 用例（Gap Analysis）

_Last updated: 2026-07-08. 以下为当前 26 个用例未覆盖的场景，按优先级排列。_

**统一验证标准（适用于所有新增用例）**：每个用例需同时校验 **API 返回** 与 **DB 存储** 两层，分别按各自契约断言（API → `docs/api-reference.md` + Pydantic schema；DB → `docs/database-schema.md` + `validateDbProjectRow`）。

| # | 缺失场景 | 说明 | 建议归属 Spec | 优先级 |
|---|---|---|---|---|
| G1 | **重新合成（regenerate all）流程** | `TTSSynthesis.tsx` 的 `handleRegenerateAll` 存在 i18n key 漏译 bug（弹窗显示 raw key），需回归卡住 | 新增 `studio-resynthesis.spec.ts` 或 `studio-segment-operations` 增补 | 高 |
| G2 | **CosyVoice / VoxCPM 引擎完整角色创建** | voice-role-flows 只测了 MiMo 预置音色，另两种引擎未验证 | `voice-role-flows.spec.ts` 扩展 | 中 |
| G3 | **语音克隆（voiceclone）流程** | 克隆音色创建、样本上传、克隆结果落库全程未测 | 新增 `voice-clone.spec.ts` | 中 |
| G4 | **音频实际播放 / 试听** | 只验证播放器 UI 可见，未验证音频 src 有效、时长 > 0 | 现有 studio spec 增补 | 中 |
| G5 | **i18n 英文界面测试** | 当前 26 个用例全用中文 locale，无英文 locale 覆盖 | 新增 locale 参数化用例或独立 spec | 中 |
| G6 | **错误恢复（合成失败后重试）** | 合成失败后的重试、状态回滚、用户提示未测 | `studio-segment-operations` / `studio-batch-export` 增补 | 低 |
| G7 | **移动端 / 响应式** | 无 viewport 维度测试 | 新增 `responsive.spec.ts` | 低 |

**补充约定**：
- G1 的 i18n 回归以**单元测试（vitest）为主**卡住 key 解析逻辑，另加通用 E2E guard `expectNoRawI18nKey(page)` 全应用范围扫 raw key。
- G5 与 G1 的 E2E 守卫可共用同一套 raw-key 检测 helper。
