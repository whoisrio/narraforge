import { Client } from '@langchain/langgraph-sdk';

// Use the agent's direct URL to avoid Vite proxy path-rewrite issues with new URL().
// VITE_AGENT_URL lets e2e stacks on custom ports (E2E_AGENT_PORT) point the
// browser at the right agent server; falls back to the historical port 2024.
// WorkflowDrawer 的 useStream 也复用此 URL，避免硬编码漂移。
export const agentApiUrl = import.meta.env.VITE_AGENT_URL
  || (typeof window !== 'undefined'
    ? `http://${window.location.hostname}:2024`
    : 'http://127.0.0.1:2024');

export const agentClient = new Client({ apiUrl: agentApiUrl });
