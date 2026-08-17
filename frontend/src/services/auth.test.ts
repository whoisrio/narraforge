import axios, { type AxiosInstance } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./authSession', () => ({
  getAccessToken: vi.fn(),
  refreshSession: vi.fn(),
  signOutLocal: vi.fn(),
}));

import { applyAuthInterceptors, isAuthRequired, setUnauthorizedHandler } from './auth';
import { getAccessToken, refreshSession, signOutLocal } from './authSession';
import api from './api';
import { api as segmentedApi } from './backendSegmentedProjectStorage';
import { api as migrationApi } from './segmentedMigration';

const mockedGetAccessToken = vi.mocked(getAccessToken);
const mockedRefreshSession = vi.mocked(refreshSession);
const mockedSignOutLocal = vi.mocked(signOutLocal);

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
      response: { status: 401, data: { detail: { code: 'auth_required' } } },
      config,
    }),
  );
  return { restore: () => { instance.defaults.adapter = original; } };
}

/** 第一次 401、其后成功（用于 refresh 后重试的场景）。 */
function failOnceThenSucceed(instance: AxiosInstance) {
  const calls: CapturedConfig[] = [];
  const original = instance.defaults.adapter;
  instance.defaults.adapter = (config) => {
    calls.push(config as CapturedConfig);
    if (calls.length === 1) {
      return Promise.reject(
        Object.assign(new Error('Request failed with status code 401'), {
          response: { status: 401, data: {} },
          config,
        }),
      );
    }
    return Promise.resolve({ data: {}, status: 200, statusText: 'OK', headers: {}, config });
  };
  return { calls, restore: () => { instance.defaults.adapter = original; } };
}

beforeEach(() => {
  mockedGetAccessToken.mockResolvedValue(null);
  mockedRefreshSession.mockResolvedValue(null);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  setUnauthorizedHandler(null);
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
  it('injects Authorization: Bearer from the supabase session token', async () => {
    vi.stubEnv('VITE_AUTH_REQUIRED', 'true');
    mockedGetAccessToken.mockResolvedValue('sb-token');
    const instance = axios.create();
    applyAuthInterceptors(instance);
    const { calls, restore } = captureRequests(instance);
    try {
      await instance.get('/config/capabilities');
      expect(authHeaderOf(calls[0])).toBe('Bearer sb-token');
    } finally {
      restore();
    }
  });

  it('does not inject when auth is off (local dev unchanged)', async () => {
    const instance = axios.create();
    applyAuthInterceptors(instance);
    const { calls, restore } = captureRequests(instance);
    try {
      await instance.get('/config/capabilities');
      expect(authHeaderOf(calls[0])).toBeUndefined();
      expect(mockedGetAccessToken).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it('does not inject when there is no session (anonymous)', async () => {
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
  ])('%s injects the Bearer token when a session exists', async (_name, instance) => {
    vi.stubEnv('VITE_AUTH_REQUIRED', 'true');
    mockedGetAccessToken.mockResolvedValue('sb-token');
    const { calls, restore } = captureRequests(instance);
    try {
      await instance.get('/config/capabilities');
      expect(authHeaderOf(calls[0])).toBe('Bearer sb-token');
    } finally {
      restore();
    }
  });
});

describe('applyAuthInterceptors 401 handling', () => {
  it('refreshes the session and retries once when a session exists', async () => {
    vi.stubEnv('VITE_AUTH_REQUIRED', 'true');
    mockedGetAccessToken.mockResolvedValue('old-token');
    // 真实实现里 refreshSession 会更新缓存；此处同步模拟后续 getAccessToken 返回新 token
    mockedRefreshSession.mockImplementation(async () => {
      mockedGetAccessToken.mockResolvedValue('new-token');
      return 'new-token';
    });
    const instance = axios.create();
    applyAuthInterceptors(instance);
    const { calls, restore } = failOnceThenSucceed(instance);
    try {
      await instance.get('/config/capabilities');
      expect(calls).toHaveLength(2);
      expect(authHeaderOf(calls[1])).toBe('Bearer new-token');
      expect(mockedSignOutLocal).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it('signs out locally and notifies when refresh fails', async () => {
    vi.stubEnv('VITE_AUTH_REQUIRED', 'true');
    mockedGetAccessToken.mockResolvedValue('old-token');
    mockedRefreshSession.mockResolvedValue(null);
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    const instance = axios.create();
    applyAuthInterceptors(instance);
    const { restore } = rejectWith401(instance);
    try {
      await expect(instance.get('/config/capabilities')).rejects.toThrow();
      expect(mockedSignOutLocal).toHaveBeenCalled();
      expect(onUnauthorized).toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it('does nothing special on anonymous 401 (no session to refresh)', async () => {
    vi.stubEnv('VITE_AUTH_REQUIRED', 'true');
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    const instance = axios.create();
    applyAuthInterceptors(instance);
    const { restore } = rejectWith401(instance);
    try {
      await expect(instance.get('/tts/history')).rejects.toThrow();
      expect(mockedRefreshSession).not.toHaveBeenCalled();
      expect(mockedSignOutLocal).not.toHaveBeenCalled();
      expect(onUnauthorized).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it('passes 401 through untouched when auth is off', async () => {
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    const instance = axios.create();
    applyAuthInterceptors(instance);
    const { restore } = rejectWith401(instance);
    try {
      await expect(instance.get('/config/capabilities')).rejects.toThrow();
      expect(mockedGetAccessToken).not.toHaveBeenCalled();
      expect(mockedRefreshSession).not.toHaveBeenCalled();
      expect(mockedSignOutLocal).not.toHaveBeenCalled();
      expect(onUnauthorized).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });
});
