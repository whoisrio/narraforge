/**
 * Dev launcher — starts backend + frontend together.
 *
 *   npm run dev
 *
 * Backend:  http://127.0.0.1:8002  (FastAPI / uvicorn)
 * Frontend: http://127.0.0.1:5173  (Vite dev server, proxies /api → backend)
 *
 * Press Ctrl+C to stop both.
 */
const { spawn } = require('node:child_process');
const { join } = require('node:path');
const { existsSync } = require('node:fs');
const os = require('node:os');

const ROOT = join(__dirname, '..');

// --- Resolve runtime ---
function resolveNodeBin(name) {
  const managed = join(os.homedir(), '.workbuddy', 'binaries', 'node', 'versions', '22.22.2', name);
  return existsSync(managed) ? managed : name;
}

const NODE_EXE = resolveNodeBin('node.exe');
const NPX_CMD = resolveNodeBin(os.platform() === 'win32' ? 'npx.cmd' : 'npx');

// --- Processes ---
const children = [];

function start(label, cmd, args, opts) {
  console.log(`[dev] Starting ${label} ...`);
  const child = spawn(cmd, args, {
    cwd: ROOT,
    env: {
      ...process.env,
      PATH: `${join(NODE_EXE, '..')}${os.platform() === 'win32' ? ';' : ':'}${process.env.PATH}`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
    ...opts,
  });

  // Prefix each output line with the process label
  const prefix = (stream, tag) => {
    let buf = '';
    child[stream].on('data', (chunk) => {
      buf += chunk.toString();
      const lines = buf.split(/\r?\n/);
      buf = lines.pop(); // keep incomplete line
      for (const line of lines) {
        if (line.trim()) process[stream === 'stdout' ? 'stdout' : 'stderr'].write(`[${tag}] ${line}\n`);
      }
    });
  };
  prefix('stdout', label);
  prefix('stderr', label);

  child.on('exit', (code) => {
    console.log(`[dev] ${label} exited (code ${code})`);
  });

  children.push(child);
  return child;
}

// --- Signal handling ---
function cleanup() {
  console.log('\n[dev] Shutting down ...');
  for (const c of children) {
    if (c.exitCode === null) {
      if (os.platform() === 'win32') {
        spawn('taskkill', ['/PID', String(c.pid), '/T', '/F'], { stdio: 'ignore' });
      } else {
        c.kill('SIGTERM');
      }
    }
  }
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
process.on('exit', cleanup);

// --- Start services ---
console.log('[dev] ========================================');
console.log('[dev] Starting NarraForge dev environment ...');
console.log('[dev] ========================================');
console.log('');

// Backend (uvicorn)
const BE_PORT = process.env.BE_PORT || '8002';
start('backend', 'uv', [
  'run', 'python', '-m', 'uvicorn', 'main:app',
  '--host', '127.0.0.1',
  '--port', BE_PORT,
  '--reload',
], { cwd: join(ROOT, 'backend') });

// Frontend (Vite)
const FE_PORT = process.env.FE_PORT || '5173';
start('frontend', 'npm', [
  'run', 'dev', '--',
  '--host', '127.0.0.1',
  '--port', FE_PORT,
], { cwd: join(ROOT, 'frontend') });

// Keep alive
process.stdin.resume();
