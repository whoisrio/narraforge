# E2E Test Guide

## Running E2E Tests

Playwright auto-starts both backend (port 8002) and frontend (port 5173) via `webServer` in `playwright.config.ts`.
No need to manually start services.

```bash
# Full suite
npx playwright test

# Single spec file
npx playwright test tests/e2e/specs/project-pages.spec.ts

# Single test by name
npx playwright test --grep "opens project and shows overview"

# With list reporter (shows pass/fail per test)
npx playwright test --reporter=list

# With custom run directory for artifacts
PW_RUN=my-run npx playwright test
```

## Directory Layout

| Path | Purpose |
|---|---|
| `tests/e2e/specs/` | Automated browser E2E specs |
| `tests/e2e/fixtures/` | Stable input fixtures (sample audio, etc.) |
| `tests/e2e/helpers/` | Shared helper code (navigation, assertions, seed) |
| `tests/e2e/manual/` | Manual verification scripts and checklists |
| `tests/e2e/snapshots/` | Visual-regression baselines |
| `test-results/` | Generated artifacts (do not commit) |

## Test Data Setup

- `global-setup.ts` sets storage mode to `backend` and seeds test data before tests run.
- `tests/e2e/helpers/seed.ts` creates a "test" project with chapters, segments, and roles via backend API.
- Duplicate roles are cleaned up automatically before seeding.

## Navigation Helpers

`tests/e2e/helpers/navigation.ts` provides:

| Helper | What it does |
|---|---|
| `enterWorkspace(page)` | Clicks "进入工作台" on landing page, waits for sidebar |
| `openTestProject(page)` | Navigates to the seeded "test" project overview |
| `goToStudio(page)` | Opens test project → navigates to studio section |
| `goToRolePage(page)` | Opens test project → navigates to role management |
| `goToVoiceDesign(page)` | Navigates to global voice design page |
| `goToLibrary(page)` | Opens test project → navigates to library |

## Data Assertions

`tests/e2e/helpers/dataAssertions.ts` provides JSON field-level validators:

| Validator | Validates |
|---|---|
| `validateEngineParams` | Engine type, voice ID, speed/volume/pitch per engine |
| `validateVoiceSource` | Source type (chapter/role/custom), role_id presence |
| `validateAudioMeta` | Format (mp3/wav), current.id/path, duration |
| `validateSplitConfig` | Delimiters array, mode (rule/llm) |
| `validateSegment` | All segment fields including voice, audio, status, emotion |
| `validateChapter` | Chapter voice, split_config, all segments |

Backend data readers:

| Reader | What it reads |
|---|---|
| `readBackendProject(page, id)` | Single project with full chapters/segments |
| `readBackendProjects(page)` | All projects (summary) |
| `readActiveProject(page)` | Most recently updated project |

## Test Requirements

### Before/After Verification

Every test must verify both UI state AND backend data before and after the operation:

1. **BEFORE** — snapshot UI state and backend data
2. **ACTION** — perform the UI operation
3. **AFTER** — verify UI changed correctly AND backend data matches

### JSON Deep Validation

Backend data with JSON fields must be validated to every sub-field, not just top-level.
Use the validators from `dataAssertions.ts` for EngineParams, VoiceSource, AudioMeta, SplitConfig.

### Console Error Collection

Use `collectErrors(page)` to capture console errors during the test.
Filter out known React warnings (empty `src` attribute, etc.) in `helpers/errors.ts`.

### Screenshots

- Save screenshots to `test-results/` for manual review.
- Do NOT send screenshots to the AI model — models don't support multimodal input.
- Use `screenshot: 'only-on-failure'` in Playwright config (default).

### CSS Module Selectors

CSS Modules hash class names. Use partial match selectors:
- `[class*="compactCard"]` instead of `[class*="segmentRow"]`
- `[class*="card"]` for generic card elements

### i18n Considerations

- Components using `useTranslation()` render in the current locale (Chinese when set).
- Components using static `t` from `i18n` always render in English.
- Use bilingual regex patterns when selectors might match either language: `/批量合成|Batch Synthesize/`

## Current Status

See `docs/e2e-test-progress.md` for pass rate, known failures, and fixes applied.
