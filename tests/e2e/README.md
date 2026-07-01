# E2E Tests and Artifacts

This directory is reserved for cross-stack browser E2E tests and E2E-related manual verification assets.

## Directory Layout

| Path | Purpose |
|---|---|
| `specs/` | Automated browser E2E specs, for example Playwright or Cypress tests. |
| `fixtures/` | Stable input fixtures used by E2E tests, such as sample audio or sample documents. |
| `helpers/` | Shared E2E helper code. |
| `manual/` | Manual browser verification scripts and checklists. These are not part of the default automated test suite. |
| `snapshots/` | Intentional visual-regression baselines or legacy reference screenshots that are safe to commit. |

## Generated Artifacts

Generated screenshots, videos, traces, and HTML reports are output to:

```text
test-results/{run_timestamp}/
```

Each E2E run creates a timestamped subdirectory. **Do not commit** anything under `test-results/`.

### Output Convention

- `test-results/{run}/` — all artifacts for that run
- Traces, screenshots, and videos are nested per test file within the run directory
- Set `PW_RUN` env to override the timestamp: `PW_RUN=project-pages/run-1 npx playwright test`

### Running E2E Tests

```bash
# Full suite (timestamped output)
npx playwright test

# Single spec
npx playwright test tests/e2e/specs/project-pages.spec.ts

# Named run directory
PW_RUN=studio-voice/run-2 npx playwright test
```

## Legacy Assets

Older ad-hoc browser verification scripts and screenshots have been moved into:

```text
tests/e2e/manual/legacy/
tests/e2e/snapshots/legacy/
```

They are kept for reference, but new automated E2E specs should go under `tests/e2e/specs/`.
