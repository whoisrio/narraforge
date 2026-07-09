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

| Reader | What it reads | Import from |
|---|---|---|
| `readBackendProject(page, id)` | Single project with full chapters/segments | `../helpers` (barrel) |
| `readBackendProjects(page)` | All projects (summary) | `../helpers` (barrel) |
| `readActiveProject(page)` | Most recently updated project | `../helpers` (barrel) |
| `readDbProject(id)` | Raw project bundle (project + chapters + segments + referenced roles) directly from the database | `../helpers/dbReader` |
| `readDbProjects()` | All project summary rows (for count/existence assertions) | `../helpers/dbReader` |
| `validateDbProjectRow(bundle)` | Validates a raw DB bundle against `docs/database-schema.md` | `../helpers/dbReader` |

> `readDbProject` / `readDbProjects` / `validateDbProjectRow` live in
> `tests/e2e/helpers/dbReader.ts` and are imported **directly** (not via the barrel),
> because they depend on `node:sqlite` (Node >= 22.5). This keeps the dependency
> isolated to DB-reading specs. See "Dual-Layer Verification" below.

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

Every write must be verified at **both** layers, because the API response and the DB
row are two independent representations that can each diverge:

- **API layer** — what the frontend and integrations see. Read with
  `readBackendProject(page, id)` and validate with `validateChapter` /
  `validateSegment` (these check the API shape, including the derived `status` field).
- **DB layer** — what was actually persisted. Read with `readDbProject(id)` (raw rows
  via `node:sqlite`) and validate with `validateDbProjectRow(bundle)` against
  `docs/database-schema.md`.

The two layers are validated against **their own contracts** — do **NOT** assert
`api === db`. They legitimately differ, e.g.:

- service-layer `datetime` → string serialization (`created_at` is a `datetime` in DB, a `str` in API);
- column mapping (`role_id`, `default_narrator_role_id`, `animation_spec_json`);
- the **flat `SegmentEngineParams`** shape in `segment.generated_params`
  (`edge_voice` / `edge_rate` / …) vs the **`EngineParams` discriminated union** in
  `chapter.voice` / `roles.voice` (`voice` / `rate` / …).

Reading both and validating each is the whole point — it catches "API looks right but
DB never persisted" and "DB stored but service maps it wrong on the way out".

**DB reader usage** (`tests/e2e/helpers/dbReader.ts`):

```ts
import { readDbProject, validateDbProjectRow } from '../helpers/dbReader';

// in the post-commit step, alongside the API read:
const db = await readDbProject('test-e2e-project');
if (!db) throw new Error('project was not persisted to the database');
validateDbProjectRow(db); // throws on any docs/database-schema.md contract violation
```

- The connector is **connection-string driven** via `DATABASE_URL` (reads `backend/.env`
  or `process.env.DATABASE_URL`). `sqlite://` is fully supported (local dev DB).
  `postgresql://` / `mysql://` are guarded with a clear error until a `pg` / `mysql2`
  connector shim is added — so the mechanism works whether the DB is local or remote.
- `node:sqlite` requires **Node >= 22.5**.
- JSON columns come back as strings from SQLite and are parsed inside
  `validateDbProjectRow`; `generated_params` is validated loosely (engine only) because
  its flat shape differs from the `EngineParams` union.

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
