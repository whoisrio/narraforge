import { defineConfig, devices } from '@playwright/test'
import path from 'node:path'
import { E2E_AGENT_PORT, E2E_AGENT_URL, E2E_BACKEND_PORT, E2E_BACKEND_URL, E2E_FRONTEND_PORT, E2E_FRONTEND_URL } from './tests/e2e/helpers/ports'

// Ensure e2e tests connect to the isolated test database.
// e2e-run.cjs sets DATABASE_URL but shell:true on Windows may strip it
// before it reaches Playwright workers — set it here as a safety net.
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'sqlite:///backend/voice_clone_e2e.db'
}

const pad = (n: number) => String(n).padStart(2, '0')
const runDir = (() => {
  if (process.env.PW_RUN) return process.env.PW_RUN
  const n = new Date()
  return `${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(n.getDate())}T${pad(n.getHours())}-${pad(n.getMinutes())}-${pad(n.getSeconds())}`
})()

export default defineConfig({
  globalSetup: './tests/e2e/global-setup.ts',
  globalTeardown: './tests/e2e/global-teardown.ts',
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
    baseURL: E2E_FRONTEND_URL,
    trace: 'on-first-retry',
    screenshot: 'on',
    video: 'on',
  },
  webServer: [
    {
      name: 'backend',
      command: `uv run --extra local-ml --extra local-services python -m uvicorn main:app --host 127.0.0.1 --port ${E2E_BACKEND_PORT}`,
      cwd: 'backend',
      env: { ENV_FILE: process.env.E2E_ENV_FILE || '.env.e2e' },
      url: `${E2E_BACKEND_URL}/health`,
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      name: 'frontend',
      command: `npm run dev -- --host 127.0.0.1 --port ${E2E_FRONTEND_PORT}`,
      cwd: 'frontend',
      url: E2E_FRONTEND_URL,
      env: {
        VITE_BACKEND_URL: E2E_BACKEND_URL,
        VITE_AGENT_URL: E2E_AGENT_URL,
      },
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      name: 'agent',
      command: `uv run langgraph dev --port ${E2E_AGENT_PORT} --no-browser`,
      cwd: 'agent',
      env: {
        BACKEND_API_URL: E2E_BACKEND_URL,
        LANGSMITH_API_KEY: '',
      },
      url: `${E2E_AGENT_URL}/assistants/narration/graph`,
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
