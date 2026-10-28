# E2E Test Guide

## Running E2E Tests

Playwright auto-starts backend (port **8012**), frontend (port **5174**), and agent (port **2024**) via `webServer` in `playwright.config.ts`.
These dedicated ports let the e2e stack coexist with a running dev environment (backend 8002 / frontend 5173) — no more dual-bind cross-traffic.
The teardown also refuses to delete anything unless the backend reports `app_env=e2e`.
No need to manually start services.

### Parallel worktrees: per-stack port overrides

All three ports are configurable via environment variables (defaults shown).
Each worktree that needs to run e2e **concurrently** with another stack must pick its own trio:

```bash
# worktree A (defaults)
npm run e2e

# worktree B (custom ports — backend / frontend / agent)
E2E_BACKEND_PORT=8022 E2E_FRONTEND_PORT=5184 E2E_AGENT_PORT=2124 npm run e2e
```

`playwright.config.ts`, global setup/teardown, helpers, and all specs read these from `tests/e2e/helpers/ports.ts` (`E2E_BACKEND_URL` etc.); the frontend webServer also receives `VITE_BACKEND_URL`/`VITE_AGENT_URL` so the browser talks to the right stack.
Each worktree has its own SQLite e2e DB (`backend/voice_clone_e2e.db` is per-worktree), so data never crosses stacks.
Note: two e2e runs in the **same** worktree still share one stack — `webServer.reuseExistingServer` means the second run attaches to the first run's servers; run them serially.

```bash
npm run e2e          # Full suite (83 tests, --workers=1, HTML report)
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
| `tests/e2e/specs/` | Automated browser E2E specs (83 tests; main app in zh-CN locale, Try page spec in en-US) |
| `tests/e2e/fixtures/` | Stable input fixtures (sample audio, images) |
| `tests/e2e/helpers/` | Shared code: data assertions, dbReader, dualReadSnapshot, navigation, seed |
| `tests/e2e/global-setup.ts` | Seed data before all tests |
| `test-results/` | Per-run failure artifacts + screenshots (ignored, do not commit) |
| `playwright-report/` | HTML reports (ignored, do not commit) |

```text
tests/e2e/
├── specs/                  ← Automated Playwright browser specs (83 tests)
├── fixtures/               ← Stable E2E input fixtures (audio, images)
├── helpers/                ← Shared utilities
│   ├── dataAssertions.ts   ← API-layer validators (validateChapter, validateSegment, …)
│   ├── dbReader.ts         ← DB-layer reader — direct SQLite access via node:sqlite
│   ├── dualReadSnapshot.ts ← Dual-read + screenshot helper
│   └── index.ts            ← Barrel exports
├── global-setup.ts         ← Seed data before all tests
└── README.md               ← Layout and artifact policy
```

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

- Except for the Try page spec (`try-page.spec.ts`, English UI under test), tests set `setLocaleToZhCN(page)` and use Chinese test names.
- Components using `useTranslation()` render correctly in Chinese.
- Components using static `t` from `i18n` always render in English — watch for these.

## Config Highlights

- `screenshot: 'on'` — viewport screenshot per test
- `--workers=1` — serial execution (shared SQLite)
- `PW_RUN=$(date +%Y-%m-%dT%H-%M-%S)` — per-run directory naming, set by `npm run e2e`
- `reuseExistingServer: !process.env.CI` — reuse local servers; CI always starts fresh
- `DATABASE_URL` — connection string for dbReader, falls back to `backend/.env`

## Testing Optimistic-Lock Conflicts

`studio-save-conflict.spec.ts` (feature §4.8) now tests two different contracts:

1. **Normal editing has no whole-project PUT.** Renaming a chapter must emit exactly one
   `PATCH /api/segmented-projects/{id}/chapters/{cid}`. The spec records every full
   `PUT /api/segmented-projects/{id}` request and asserts the list stays empty across the
   old debounce window, with no conflict dialog and API + DB double reads.
2. **Load-time stale drafts still get adjudicated.** There is no deterministic way to
   produce a save-time 409 through the UI anymore (autosave is entity-scoped), so the
   spec writes a stale `project_drafts` record directly into IndexedDB with an old
   `base_updated_at`, advances the server through a raw API write, then reloads and
   opens the project. The conflict modal must appear; "use draft" must force-save with
   **no** `base_updated_at` and persist to API + DB, while "use backend" must adopt the
   server state and leave a retrievable archive.

Useful techniques:

- `page.evaluate` + `indexedDB.open('voice_clone_studio')` seeds the stale draft; the
  draft must be `dirty: true` and its `base_updated_at` more than 2s older than the
  server's `updated_at` (the conflict tolerance).
- `page.request.*` bypasses `page.route` completely, which is exactly what makes the
  "external writer" (agent / second tab) simulation possible from inside the same test.
- `page.route` is still used in `studio-playback-during-tts.spec.ts`, but instead of
  parking the regenerate POST it injects the e2e-only `x-e2e-synth-delay-ms` header
  (honored only when `APP_ENV=e2e`): the backend runs the synthesis in a worker
  thread and sleeps there, so the "synthesis in flight" window is deterministic
  while the event loop stays free. The test clicks another segment's play button
  during that window and asserts its audio GET returns immediately with
  byte-identical content (sha256), plus that the synthesizing segment shows
  「合成中」 instead of a play button.
- Assert request payloads (not just end state): e.g. chapter rename sends only
  `{name}`, force-save omits `base_updated_at`.

## Pending E2E Coverage (Gap Analysis)

All 83 current tests pass (count via `npx playwright test --list`). The following scenarios are not yet covered.

**Verification standard for new tests**: Every test must verify both API and DB layers
against their own contracts (API → `docs/api-reference.md` + Pydantic schema; DB →
`docs/database-schema.md` + `validateDbProjectRow`).

| # | Missing Scenario | Details | Suggested Location | Priority |
|---|---|---|---|---|
| G1 | **Regenerate All flow** | i18n raw-key regression covered by `studio-resynthesis.spec.ts` + `i18n.test.ts` + E2E guard | `studio-resynthesis.spec.ts` | High | ✅ Done |
| G2 | **CosyVoice / VoxCPM role creation** | voice-role-flows only tests MiMo preset; other engines not verified | Extend `voice-role-flows.spec.ts` | Medium |
| G3 | **Voice Clone flow** | MiMo clone: upload → preview → create → verify — covered by `voice-clone.spec.ts` | `voice-clone.spec.ts` | Medium | ✅ Done |
| G4 | **Actual audio playback** | Only checks player UI visibility; does not verify audio src is valid and duration > 0 | Extend existing studio specs | Medium |
| G5 | **English locale UI** | All 83 tests use Chinese locale; no English locale coverage | New locale-parameterized spec or standalone `i18n-en.spec.ts` | Medium |
| G6 | **Error recovery** | Synthesis-failure retry, state rollback, user feedback — untested | Extend `studio-segment-operations` / `studio-batch-export` | Low |
| G7 | **Mobile / responsive** | No viewport-dimension tests | New `responsive.spec.ts` | Low |
| G8 | **Knowledge video workflow entry + storyboard** | 工作流类型入口 + 分镜视图（brief API 预置 + 双层验证） | `knowledge-video-workflow.spec.ts` | Medium | ✅ Done |
| G9 | **Chapter & segment reorder** | 章节侧边栏 + 段落行 ↑/↓ 调整顺序，UI->API->DB `position` 三层一致 | `reorder.spec.ts` | Medium | ✅ Done |
| G10 | **重拆保留真实 UI 路径** | S1 默认路径（不碰勾选框）重拆文档不改 → 音频全保留；S3 章节重组（加标题、文本逐字未动）→ 全局兜底保留；含 dry_run 诚实确认文案与 UI->API->DB->FS 四层验证 | `chapter-split-preserve-audio.spec.ts` | High | ✅ Done |
| G12 | **Try 页（/try 获客页）** | SEO 静态内容、3000 字上限、真实 edge_tts 合成链路、历史记录（重复下载/删除/清空）、全部下载打包 zip、下载推荐弹窗每 5 次下载一次（页面停留计数、刷新归零）、「试用完整功能」内容接力进主应用 | `try-page.spec.ts` | High | ✅ Done |
| G11 | **Library 文档优先 IA** | 默认落 doc 视图、形态 A 粘贴 CTA + 去源文档、拆分后留在 doc + 结果反馈跳转、源文档视图可访问、视图记忆；章节/段落逐字段 API + DB 双读 | `library-doc-first.spec.ts` | High | ✅ Done |
| G13 | **Studio 搜索 + 合成时文本变换** | 全项目搜索跳转（切章节/定位/闪烁）、发音映射（逐段勾选 + apply_all）、大写转小写（项目默认 + 段级三态覆盖）；`generated_params.effective_text` 双读断言 | `studio-text-transforms.spec.ts` | High | ✅ Done |
| G14 | **细粒度保存 + 加载期冲突裁决** | 章节改名只发 `PATCH /chapters/{id}`、零整包 PUT、零冲突弹窗；加载期陈旧草稿（IndexedDB 注入）→ 模态 → 「用草稿」force save（无 base）落库、「用后端」采纳后归档找回；请求 payload + API/DB 双读 | `studio-save-conflict.spec.ts` | High | ✅ Done |
| G15 | **TTS 语音核对（ASR 回读验收）** | 紧凑行角标双职责：未核对点角标直接核对（不建 run，runs 快照对比）→ 全量核对 → 报告弹层（不一致计数 + ASR 回读文本）→ 不一致（badge + API/SQLite 双读）→ 只看不一致过滤 → 忽略 → 重挂音频（audio_key 作废，真实 edge-tts 被 403 时等价驱动）→ 幂等续跑只补缺（报告仅含本次 run 发现）→ 防重 409 + 快照 pill + 回拨心跳 → interrupted 提示 → 续跑（runs 表双读）。后端以 `TTS_VERIFY_STUB=1` 运行（`.env.e2e`） | `studio-tts-verify.spec.ts` | High | ✅ Done |
| G16 | **合成期间播放互不阻塞** | 真实合成 A、B 两段 → `page.route` 给 A 的重新合成 POST 注入 `x-e2e-synth-delay-ms`（后端 worker 线程真实慢合成 8s）→ A 紧凑/展开行播放按钮替换为「合成中」、编辑面板重新生成按钮禁用 → B 播放按钮仍可见，点击后音频 GET 立即返回（<4s）且 sha256 与合成前一致 → 无「暂无音频/播放失败」提示 → 合成完成后 A 恢复播放按钮，current/previous 独立落盘、B 字节级未变 | `studio-playback-during-tts.spec.ts` | High | ✅ Done |

**Additional rules**:
- G1 i18n regression: primarily covered by **unit tests (vitest)** validating key resolution;
  complement with a global E2E guard `expectNoRawI18nKey(page)` scanning the entire app for leaked raw keys.
- G5 can reuse the same raw-key detection helper as G1.
