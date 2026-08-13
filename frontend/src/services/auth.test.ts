import axios, { type AxiosInstance } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyAuthInterceptors,
  clearToken,
  getToken,
  isAuthRequired,
  reloadPage,
  setToken,
} from './auth';
import api from './api';
import { api as segmentedApi } from './backendSegmentedProjectStorage';
import { api as migrationApi } from './segmentedMigration';

function stubReload() {
  const reloadSpy = vi.fn();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, reload: reloadSpy },
  });
  return reloadSpy;
}

type CapturedConfig = { headers?: { get?: (k: string) => string | undefined; Authorization?: string } };

function authHeaderOf(config: CapturedConfig): string | undefined {
  return config.headers?.get?.('Authorization') ?? config.headers?.Authorization;
}

/** 用自定义 adapter 捕获实例实际发出的请求配置。 */
function captureRequests(instance: AxiosInstance) {
  const calls: CapturedConfig[] = [];
  const original = instance.defaults.adapter;
  instance.defaults.adapter = (config) => {
    calls.push(config as CapturedConfig);
    return Promise.resolve({ data: {}, status: 200, statusText: 'OK', headers: {}, config });
  };
  return { calls, restore: () => { instance.defaults.adapter = original; } };
}

function rejectWith401(instance: AxiosInstance) {
  const original = instance.defaults.adapter;
  instance.defaults.adapter = (config) => Promise.reject(
    Object.assign(new Error('Request failed with status code 401'), {
      response: { status: 401, data: {} },
      config,
    }),
  );
  return { restore: () => { instance.defaults.adapter = original; } };
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('token storage', () => {
  it('returns null when no token stored', () => {
    expect(getToken()).toBeNull();
  });

  it('setToken/getToken roundtrip via nf_access_token', () => {
    setToken('tok123');
    expect(localStorage.getItem('nf_access_token')).toBe('tok123');
    expect(getToken()).toBe('tok123');
  });

  it('clearToken removes the stored token', () => {
    setToken('tok123');
    clearToken();
    expect(getToken()).toBeNull();
    expect(localStorage.getItem('nf_access_token')).toBeNull();
  });
});

describe('isAuthRequired', () => {
  it('is false when VITE_AUTH_REQUIRED is unset (local dev unaffected)', () => {
    expect(isAuthRequired()).toBe(false);
  });

  it('is true only when VITE_AUTH_REQUIRED === "true"', () => {
    vi.stubEnv('VITE_AUTH_REQUIRED', 'true');
    expect(isAuthRequired()).toBe(true);
    vi.stubEnv('VITE_AUTH_REQUIRED', 'false');
    expect(isAuthRequired()).toBe(false);
  });
});

describe('applyAuthInterceptors request injection', () => {
  it('injects Authorization: Bearer when auth required and token present', async () => {
    vi.stubEnv('VITE_AUTH_REQUIRED', 'true');
    setToken('tok123');
    const instance = axios.create();
    applyAuthInterceptors(instance);
    const { calls, restore } = captureRequests(instance);
    try {
      await instance.get('/config/capabilities');
      expect(authHeaderOf(calls[0])).toBe('Bearer tok123');
    } finally {
      restore();
    }
  });

  it('does not inject when auth is off (local dev unchanged)', async () => {
    setToken('tok123');
    const instance = axios.create();
    applyAuthInterceptors(instance);
    const { calls, restore } = captureRequests(instance);
    try {
      await instance.get('/config/capabilities');
      expect(authHeaderOf(calls[0])).toBeUndefined();
    } finally {
      restore();
    }
  });

  it('does not inject when no token stored', async () => {
    vi.stubEnv('VITE_AUTH_REQUIRED', 'true');
    const instance = axios.create();
    applyAuthInterceptors(instance);
    const { calls, restore } = captureRequests(instance);
    try {
      await instance.get('/config/capabilities');
      expect(authHeaderOf(calls[0])).toBeUndefined();
    } finally {
      restore();
    }
  });
});

describe('shared axios instances wiring', () => {
  it.each([
    ['services/api', api],
    ['backendSegmentedProjectStorage', segmentedApi],
    ['segmentedMigration', migrationApi],
  ])('%s injects the Bearer token when auth is required', async (_name, instance) => {
    vi.stubEnv('VITE_AUTH_REQUIRED', 'true');
    setToken('tok123');
    const { calls, restore } = captureRequests(instance);
    try {
      await instance.get('/config/capabilities');
      expect(authHeaderOf(calls[0])).toBe('Bearer tok123');
    } finally {
      restore();
    }
  });
});

describe('applyAuthInterceptors 401 handling', () => {
  it('clears the token and reloads on 401 when auth required', async () => {
    vi.stubEnv('VITE_AUTH_REQUIRED', 'true');
    const reloadSpy = stubReload();
    setToken('tok123');
    const instance = axios.create();
    applyAuthInterceptors(instance);
    const { restore } = rejectWith401(instance);
    try {
      await expect(instance.get('/config/capabilities')).rejects.toThrow();
      expect(getToken()).toBeNull();
      expect(reloadSpy).toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it('keeps the token and does not reload on 401 when auth is off', async () => {
    const reloadSpy = stubReload();
    setToken('tok123');
    const instance = axios.create();
    applyAuthInterceptors(instance);
    const { restore } = rejectWith401(instance);
    try {
      await expect(instance.get('/config/capabilities')).rejects.toThrow();
      expect(getToken()).toBe('tok123');
      expect(reloadSpy).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });
});

describe('reloadPage', () => {
  it('delegates to window.location.reload', () => {
    const reloadSpy = stubReload();
    reloadPage();
    expect(reloadSpy).toHaveBeenCalled();
  });
});
