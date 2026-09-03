/**
 * 加载反馈 E2E 专用配置（临时）。
 *
 * 与 playwright.config.ts 的区别：
 *   - 移除 agent webServer（本次验证不覆盖 agent，用户已确认）。
 *   - 移除 backend / frontend webServer：这两个服务由外部手动拉起并已在运行，
 *     避免 Playwright 的 reuseExistingServer 探测在沙箱中失效后重复起服务导致端口冲突超时。
 *
 * 运行前需确保：
 *   backend  uvicorn 已在 http://127.0.0.1:8012 且 app_env=e2e
 *   frontend vite     已在 http://127.0.0.1:5174
 */
import { defineConfig, devices } from '@playwright/test';
import { E2E_BACKEND_URL, E2E_FRONTEND_URL } from './tests/e2e/helpers/ports';

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'sqlite:///backend/voice_clone_e2e.db';
}

export default defineConfig({
  globalSetup: './tests/e2e/global-setup.ts',
  globalTeardown: './tests/e2e/global-teardown.ts',
  testDir: './tests/e2e/specs',
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  outputDir: 'test-results/loading-e2e',
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report/loading-e2e' }],
  ],
  use: {
    baseURL: E2E_FRONTEND_URL,
    trace: 'on-first-retry',
    screenshot: 'on',
    video: 'on',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
