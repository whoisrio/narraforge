/**
 * Cross-platform E2E runner.
 *
 * Sets PW_RUN timestamp and DATABASE_URL, then spawns Playwright.
 * Used by the npm "e2e" script — works on macOS, Linux, and Windows.
 */
const { spawnSync } = require('node:child_process');
const { join } = require('node:path');

const { existsSync } = require('node:fs');
const os = require('node:os');

const ROOT = join(__dirname, '..');

// Filesystem-safe timestamp: 2026-07-09T19-10-00
const ts = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');

// Resolve Node.js: prefer managed Node 22 (bundled with WorkBuddy) over system Node.
// Node 22+ is required because Playwright & its dependencies use ESM modules
// that need native require(esm) support (unavailable in Node 20).
function resolveNodeBin(name) {
  const candidates = [
    // Managed Node 22 (WorkBuddy)
    join(os.homedir(), '.workbuddy', 'binaries', 'node', 'versions', '22.22.2', name),
    // Fallback: rely on PATH
    name,
  ];
  for (const c of candidates) {
    if (c === name) return c; // PATH fallback
    if (existsSync(c)) return c;
  }
  return name;
}

const NODE_EXE = resolveNodeBin('node.exe');
const NPX_CMD = resolveNodeBin(process.platform === 'win32' ? 'npx.cmd' : 'npx');

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
console.log(`[e2e] node = ${NODE_EXE}`);
console.log(`[e2e] npx  = ${NPX_CMD}`);

const result = spawnSync(NPX_CMD, cmdArgs, {
  cwd: ROOT,
  env: { ...env, PATH: `${join(NODE_EXE, '..')}${os.platform() === 'win32' ? ';' : ':'}${env.PATH}` },
  stdio: 'inherit',
  shell: true,
});
process.exit(result.status ?? 1);
