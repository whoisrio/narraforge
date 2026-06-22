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

Generated screenshots, videos, traces, and HTML reports should not be committed here.

Use ignored artifact directories instead:

```text
test-results/
playwright-report/
.artifacts/e2e/
```

Only commit screenshots under `snapshots/` when they are intentional baselines or useful legacy references.

## Legacy Assets

Older ad-hoc browser verification scripts and screenshots have been moved into:

```text
tests/e2e/manual/legacy/
tests/e2e/snapshots/legacy/
```

They are kept for reference, but new automated E2E specs should go under `tests/e2e/specs/`.
