# E2E Test Guide

## Running E2E Tests

Playwright auto-starts both backend (port 8002) and frontend (port 5173) via `webServer` in `playwright.config.ts`.
No need to manually start services.

```bash
npm run e2e          # Full suite (26 tests, --workers=1, HTML report)
npm run e2e:ui       # Playwright visual test explorer
npm run e2e:report   # Open latest HTML report
npm run e2e:clean    # Remove all test-results/ and playwright-report/ dirs

# Single spec file
npx playwright test tests/e2e/specs/project-pages.spec.ts --workers=1

# Single test by name
npx playwright test --grep "打开项目" --workers=1
```

Tests run **serially** (`--workers=1`) because they share a single SQLite database.
Playwright's `webServer` config bypasses WorkBuddy's sandbox (which would block `shutil.rmtree` during project deletion).

## Directory Layout

| Path | Purpose |
|---|---|
| `tests/e2e/specs/` | Automated browser E2E specs (26 tests, all Chinese locale) |
| `tests/e2e/fixtures/` | Stable input fixtures (sample audio, images) |
| `tests/e2e/helpers/` | Shared code: data assertions, dbReader, dualReadSnapshot, navigation, seed |
| `tests/e2e/global-setup.ts` | Seed data before all tests |
| `test-results/` | Per-run failure artifacts + screenshots (ignored, do not commit) |
| `playwright-report/` | HTML reports (ignored, do not commit) |

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

| Reader | What it reads | Import from |
|---|---|---|
| `readBackendProject(page, id)` | Single project with full chapters/segments | `../helpers` (barrel) |
| `readBackendProjects(page)` | All projects (summary) | `../helpers` (barrel) |
| `readActiveProject(page)` | Most recently updated project | `../helpers` (barrel) |
| `readDbProject(id)` | Raw project bundle (project + chapters + segments + roles) directly from SQLite | `../helpers/dbReader` |
| `readDbProjects()` | All project summary rows | `../helpers/dbReader` |
| `validateDbProjectRow(bundle)` | Validates a raw DB bundle against `docs/database-schema.md` | `../helpers/dbReader` |
| `verifyDbWithScreenshot(page, id, label)` | DB read + schema validation + labeled screenshot | `../helpers/dualReadSnapshot` |

> `readDbProject` / `readDbProjects` / `validateDbProjectRow` live in
> `tests/e2e/helpers/dbReader.ts` and are imported **directly** (not via the barrel),
> because they depend on `node:sqlite` (Node >= 22.5).

## Test Requirements

### Before/After Verification

Every test must verify both UI state AND backend data before and after the operation:

1. **BEFORE** — snapshot UI state and backend data
2. **ACTION** — perform the UI operation
3. **AFTER** — verify UI changed correctly AND backend data matches

### JSON Deep Validation

Backend data with JSON fields must be validated to every sub-field, not just top-level.
Use the validators from `dataAssertions.ts` for EngineParams, VoiceSource, AudioMeta, SplitConfig.

### Dual-Layer Verification (API + DB)

Every write must be verified at **both** layers:

- **API layer** — what the frontend sees. Read with `readBackendProject(page, id)` and
  validate with `validateChapter` / `validateSegment`.
- **DB layer** — what was actually persisted. Read with `readDbProject(id)` and validate
  with `validateDbProjectRow(bundle)` against `docs/database-schema.md`.

The two layers are validated against **their own contracts** — do **NOT** assert `api === db`.
They legitimately differ (datetime serialization, column mapping, flat vs discriminated union shapes).

The `verifyDbWithScreenshot()` helper wraps both DB read + validation + a labeled
viewport screenshot that appears in the HTML report automatically.

### Console Error Collection

Use `collectErrors(page)` to capture console errors during the test.
Filter out known React warnings (empty `src` attribute, etc.) in `helpers/errors.ts`.

### Screenshots

- `screenshot: 'on'` in Playwright config — every test captures a viewport screenshot at completion.
- `verifyDbWithScreenshot()` captures additional screenshots at each dual-read verification point.
- All screenshots appear in the HTML report (`npm run e2e:report`).
- Generated artifacts go to `test-results/` and `playwright-report/` — **do not commit**.

### CSS Module Selectors

CSS Modules hash class names. Use partial match selectors:
- `[class*="compactCard"]` instead of `[class*="segmentRow"]`
- `[class*="card"]` for generic card elements

### i18n Considerations

- All 26 tests set `setLocaleToZhCN(page)` and use Chinese test names.
- Components using `useTranslation()` render correctly in Chinese.
- Components using static `t` from `i18n` always render in English — watch for these.

## Config Highlights

- `screenshot: 'on'` — viewport screenshot per test
- `--workers=1` — serial execution (shared SQLite)
- `PW_RUN=$(date +%Y-%m-%dT%H-%M-%S)` — per-run directory naming, set by `npm run e2e`
- `reuseExistingServer: !process.env.CI` — reuse local servers; CI always starts fresh
- `DATABASE_URL` — connection string for dbReader, falls back to `backend/.env`

See `docs/e2e-test-progress.md` for current status and gap analysis.
