import { Client } from '@langchain/langgraph-sdk';

// Use the agent's direct URL to avoid Vite proxy path-rewrite issues with new URL().
const apiUrl = typeof window !== 'undefined'
  ? `http://${window.location.hostname}:2024`
  : 'http://127.0.0.1:2024';

export const agentClient = new Client({ apiUrl });