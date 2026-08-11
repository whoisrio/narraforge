import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('agentApiUrl', () => {
  it('falls back to <hostname>:2024 when VITE_AGENT_URL is unset (本地默认不变)', async () => {
    const { agentApiUrl } = await import('./client');
    expect(agentApiUrl).toBe(`http://${window.location.hostname}:2024`);
  });

  it('uses VITE_AGENT_URL when provided', async () => {
    vi.stubEnv('VITE_AGENT_URL', 'https://agent.example.com');
    const { agentApiUrl } = await import('./client');
    expect(agentApiUrl).toBe('https://agent.example.com');
  });
});
