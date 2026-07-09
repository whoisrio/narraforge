/**
 * Cross-platform E2E runner.
 *
 * Sets PW_RUN timestamp and DATABASE_URL, then spawns Playwright.
 * Used by the npm "e2e" script — works on macOS, Linux, and Windows.
 */
const { spawnSync } = require('node:child_process');
const { join } = require('node:path');

const ROOT = join(__dirname, '..');

// Filesystem-safe timestamp: 2026-07-09T19-10-00
const ts = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');

const env = {
  ...process.env,
  PW_RUN: ts,
  DATABASE_URL: 'sqlite:///backend/voice_clone_e2e.db',
};

const args = process.argv.slice(2);
// Explicit cross-platform flags (no shell globbing needed)
const cmdArgs = ['playwright', 'test', '--workers=1', ...args];

console.log(`[e2e] PW_RUN=${ts}`);
console.log(`[e2e] DATABASE_URL=${env.DATABASE_URL}`);

const result = spawnSync('npx', cmdArgs, { cwd: ROOT, env, stdio: 'inherit', shell: true });
process.exit(result.status ?? 1);
