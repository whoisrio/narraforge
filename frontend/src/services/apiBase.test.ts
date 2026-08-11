import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('apiUrl / API_BASE_URL', () => {
  it('defaults to the /api prefix when VITE_API_BASE_URL is unset', async () => {
    const { apiUrl, API_BASE_URL } = await import('./apiBase');
    expect(API_BASE_URL).toBe('/api');
    expect(apiUrl('/clone/list')).toBe('/api/clone/list');
    expect(apiUrl('config/capabilities')).toBe('/api/config/capabilities');
  });

  it('uses VITE_API_BASE_URL when provided (workers 部署指向独立 API 域名)', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.com/api');
    const { apiUrl, API_BASE_URL } = await import('./apiBase');
    expect(API_BASE_URL).toBe('https://api.example.com/api');
    expect(apiUrl('/clone/list')).toBe('https://api.example.com/api/clone/list');
  });

  it('trims trailing slashes of VITE_API_BASE_URL to avoid double slashes', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.com/api/');
    const { apiUrl } = await import('./apiBase');
    expect(apiUrl('/config/capabilities')).toBe('https://api.example.com/api/config/capabilities');
  });
});
