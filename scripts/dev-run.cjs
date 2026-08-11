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
    // POSIX: 让子进程成为进程组组长，关停时按组杀（shell 包装的 uvicorn reloader/worker 才能一起收掉）
    detached: os.platform() !== 'win32',
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
function killChild(c, signal) {
  if (c.exitCode !== null) return;
  if (os.platform() === 'win32') {
    spawn('taskkill', ['/PID', String(c.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    // 按进程组杀（detached: true 使子进程成为组长），覆盖 shell 包装下的所有子孙进程
    try {
      process.kill(-c.pid, signal);
    } catch {
      try { c.kill(signal); } catch { /* already dead */ }
    }
  }
}

async function cleanup() {
  console.log('\n[dev] Shutting down ...');
  for (const c of children) killChild(c, 'SIGTERM');

  // 等子进程真正退出；3 秒后仍存活的升级 SIGKILL，避免孤儿进程占住端口
  const deadline = Date.now() + 3000;
  const alive = () => children.filter(c => c.exitCode === null);
  while (alive().length > 0 && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 100));
  }
  for (const c of alive()) killChild(c, 'SIGKILL');

  process.exit(0);
}

process.on('SIGINT', () => { void cleanup(); });
process.on('SIGTERM', () => { void cleanup(); });

// --- Start services ---
console.log('[dev] ========================================');
console.log('[dev] Starting NarraForge dev environment ...');
console.log('[dev] ========================================');
console.log('');

// Backend (uvicorn)
const BE_PORT = process.env.BE_PORT || '8002';
start('backend', 'uv', [
  'run', '--extra', 'local-ml', '--extra', 'local-services',
  'python', '-m', 'uvicorn', 'main:app',
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
