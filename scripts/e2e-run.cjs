/**
 * Cross-platform E2E runner.
 *
 * Detects managed Node.js 22 (WorkBuddy-bundled) for ESM compatibility,
 * sets PW_RUN timestamp and DATABASE_URL, then spawns Playwright.
 *
 * By default excludes @workflow tests (they call real LLM APIs and take 30+ min).
 * Use --workflow to run ONLY workflow tests, or pass any extra args through.
 *
 * Used by the npm "e2e" script — works on macOS, Linux, and Windows.
 */
const { spawn } = require('node:child_process');
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
    join(os.homedir(), '.workbuddy', 'binaries', 'node', 'versions', '22.22.2', name),
    name, // Fallback: rely on PATH
  ];
  for (const c of candidates) {
    if (c === name) return c;
    if (existsSync(c)) return c;
  }
  return name;
}

const NODE_EXE = resolveNodeBin('node.exe');
const NPX_CMD = resolveNodeBin(process.platform === 'win32' ? 'npx.cmd' : 'npx');

// Allow overriding the database URL and env file for production-DB verification.
// Usage: E2E_DATABASE_URL=sqlite:///backend/voice_clone.db E2E_ENV_FILE=.env.prod-test node scripts/e2e-run.cjs
const E2E_DATABASE_URL = process.env.E2E_DATABASE_URL || 'sqlite:///backend/voice_clone_e2e.db';
const E2E_ENV_FILE = process.env.E2E_ENV_FILE || '.env.e2e';

const env = {
  ...process.env,
  PW_RUN: ts,
  DATABASE_URL: E2E_DATABASE_URL,
  E2E_ENV_FILE,
  PATH: `${join(NODE_EXE, '..')}${os.platform() === 'win32' ? ';' : ':'}${process.env.PATH}`,
};

// Parse CLI args: --workflow runs only @workflow tests, everything else passes through.
const userArgs = process.argv.slice(2);
const isWorkflowOnly = userArgs.includes('--workflow');
const filteredArgs = userArgs.filter(a => a !== '--workflow');

// Build Playwright args
const pwArgs = ['playwright', 'test', '--workers=1'];

if (isWorkflowOnly) {
  pwArgs.push('--grep', '@workflow');
} else {
  // Exclude slow @workflow tests from the default run
  pwArgs.push('--grep-invert', '@workflow');
}

pwArgs.push(...filteredArgs);

console.log(`[e2e] PW_RUN=${ts}`);
console.log(`[e2e] DATABASE_URL=${env.DATABASE_URL}`);
console.log(`[e2e] ENV_FILE=${E2E_ENV_FILE}`);
console.log(`[e2e] node = ${NODE_EXE}`);
console.log(`[e2e] npx  = ${NPX_CMD}`);
console.log(`[e2e] mode = ${isWorkflowOnly ? 'workflow-only' : 'fast (excludes @workflow)'}`);
console.log(`[e2e] args = ${pwArgs.join(' ')}`);

// Use spawn (async) instead of spawnSync to avoid hanging when child
// processes (uvicorn, vite) don't exit cleanly on Windows.
const child = spawn(NPX_CMD, pwArgs, {
  cwd: ROOT,
  env,
  stdio: 'inherit',
  shell: true,
});

// Forward Ctrl+C / SIGTERM to the child process
child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exit(code ?? 1);
  }
});

process.on('SIGINT', () => {
  child.kill('SIGINT');
  process.exit(130);
});

process.on('SIGTERM', () => {
  child.kill('SIGTERM');
  process.exit(143);
});
