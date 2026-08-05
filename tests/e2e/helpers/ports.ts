/**
 * E2E port configuration.
 *
 * Defaults match the historical dedicated e2e ports so plain `npm run e2e`
 * behaves exactly as before. Parallel worktrees can each run their own e2e
 * stack by overriding the ports, e.g.:
 *
 *   E2E_BACKEND_PORT=8022 E2E_FRONTEND_PORT=5184 E2E_AGENT_PORT=2124 npm run e2e
 */
export const E2E_BACKEND_PORT = Number(process.env.E2E_BACKEND_PORT || 8012);
export const E2E_FRONTEND_PORT = Number(process.env.E2E_FRONTEND_PORT || 5174);
export const E2E_AGENT_PORT = Number(process.env.E2E_AGENT_PORT || 2024);

export const E2E_BACKEND_URL = `http://127.0.0.1:${E2E_BACKEND_PORT}`;
export const E2E_FRONTEND_URL = `http://127.0.0.1:${E2E_FRONTEND_PORT}`;
export const E2E_AGENT_URL = `http://127.0.0.1:${E2E_AGENT_PORT}`;
