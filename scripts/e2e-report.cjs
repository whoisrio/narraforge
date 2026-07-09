/**
 * E2E report viewer.
 *
 * Opens the latest Playwright HTML report in the default browser.
 * Uses the managed Node 22 runtime to avoid ESM/CJS issues on Node 20.
 *
 * The report server runs in the foreground (spawn, not spawnSync).
 * Press Ctrl+C to stop it.
 */
const { spawn } = require('node:child_process');
const { readdirSync, statSync, existsSync } = require('node:fs');
const { join } = require('node:path');
const os = require('node:os');
const net = require('node:net');

const ROOT = join(__dirname, '..');

// Resolve Node.js: prefer managed Node 22 (same as e2e-run.cjs)
function resolveNodeBin(name) {
  const candidates = [
    join(os.homedir(), '.workbuddy', 'binaries', 'node', 'versions', '22.22.2', name),
    name,
  ];
  for (const c of candidates) {
    if (c === name) return c;
    if (existsSync(c)) return c;
  }
  return name;
}

const NODE_EXE = resolveNodeBin('node.exe');
const NPX_CMD = resolveNodeBin(os.platform() === 'win32' ? 'npx.cmd' : 'npx');

// --- Find an available port ---
function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

// --- Find latest report ---
function findLatestReport() {
  const reportDir = join(ROOT, 'playwright-report');

  if (!existsSync(reportDir)) {
    console.error('[e2e:report] No playwright-report/ directory found.');
    console.error('[e2e:report] Run "npm run e2e" first to generate a report.');
    process.exit(1);
  }

  const dirs = readdirSync(reportDir)
    .filter(x => statSync(join(reportDir, x)).isDirectory())
    .sort();

  if (dirs.length === 0) {
    console.error('[e2e:report] No report subdirectories found in playwright-report/.');
    console.error('[e2e:report] Run "npm run e2e" first to generate a report.');
    process.exit(1);
  }

  // ISO timestamps sort alphabetically = chronologically; last = latest
  return dirs[dirs.length - 1];
}

// --- Main ---
(async () => {
  const latest = findLatestReport();
  const reportPath = join('playwright-report', latest);
  const port = await findFreePort();

  console.log(`[e2e:report] Latest report: ${latest}`);
  console.log(`[e2e:report] Starting server on http://127.0.0.1:${port}`);
  console.log(`[e2e:report] node: ${NODE_EXE}`);
  console.log(`[e2e:report] Press Ctrl+C to stop\n`);

  const child = spawn(NPX_CMD, [
    'playwright', 'show-report',
    '--host', '127.0.0.1',
    '--port', String(port),
    reportPath,
  ], {
    cwd: ROOT,
    env: {
      ...process.env,
      PATH: `${join(NODE_EXE, '..')}${os.platform() === 'win32' ? ';' : ':'}${process.env.PATH}`,
    },
    stdio: 'inherit',
    shell: true,
  });

  child.on('exit', (code) => {
    process.exit(code ?? 0);
  });
})();
