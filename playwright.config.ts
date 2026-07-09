import { defineConfig, devices } from '@playwright/test'
import path from 'node:path'

const pad = (n: number) => String(n).padStart(2, '0')
const runDir = (() => {
  if (process.env.PW_RUN) return process.env.PW_RUN
  const n = new Date()
  return `${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(n.getDate())}T${pad(n.getHours())}-${pad(n.getMinutes())}-${pad(n.getSeconds())}`
})()

export default defineConfig({
  globalSetup: './tests/e2e/global-setup.ts',
  testDir: './tests/e2e/specs',
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  outputDir: path.join('test-results', runDir),
  reporter: [
    ['list'],
    ['html', { outputFolder: path.join('playwright-report', runDir) }],
  ],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'on-first-retry',
    screenshot: 'on',
    video: 'on',
  },
  webServer: [
    {
      name: 'backend',
      command: 'cd backend && uv run uvicorn main:app --host 127.0.0.1 --port 8002',
      url: 'http://127.0.0.1:8002/health',
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      name: 'frontend',
      command: 'cd frontend && npm run dev -- --host 127.0.0.1 --port 5173',
      url: 'http://127.0.0.1:5173',
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
