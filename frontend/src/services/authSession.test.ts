import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const authApi = vi.hoisted(() => ({
  onAuthStateChange: vi.fn(),
  getSession: vi.fn(),
  refreshSession: vi.fn(),
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ auth: authApi })),
}));

import { createClient } from '@supabase/supabase-js';
import {
  __resetAuthSessionForTests,
  getAccessToken,
  getSession,
  getSupabase,
  isAuthConfigured,
  onAuthStateChange,
  refreshSession,
  signIn,
  signOut,
  signUp,
} from './authSession';

const SESSION = {
  access_token: 'sb-access',
  refresh_token: 'sb-refresh',
  user: { id: 'u1', email: 'a@b.c' },
} as never;

function stubAuthEnv() {
  vi.stubEnv('VITE_AUTH_REQUIRED', 'true');
  vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key');
}

beforeEach(() => {
  __resetAuthSessionForTests();
  authApi.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });
  authApi.signOut.mockResolvedValue({});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  __resetAuthSessionForTests();
});

describe('getSupabase', () => {
  it('throws a clear error when auth is disabled', () => {
    expect(() => getSupabase()).toThrow(/VITE_AUTH_REQUIRED/);
  });

  it('throws a clear error when supabase env vars are missing', () => {
    vi.stubEnv('VITE_AUTH_REQUIRED', 'true');
    expect(isAuthConfigured()).toBe(false);
    expect(() => getSupabase()).toThrow(/VITE_SUPABASE_URL/);
  });

  it('creates the client lazily and only once', () => {
    stubAuthEnv();
    const first = getSupabase();
    const second = getSupabase();
    expect(first).toBe(second);
    expect(createClient).toHaveBeenCalledTimes(1);
    expect(createClient).toHaveBeenCalledWith('https://example.supabase.co', 'anon-key');
  });
});

describe('session helpers', () => {
  it('getSession returns null when auth is disabled', async () => {
    await expect(getSession()).resolves.toBeNull();
    await expect(getAccessToken()).resolves.toBeNull();
  });

  it('getSession reads from supabase and caches the session', async () => {
    stubAuthEnv();
    authApi.getSession.mockResolvedValue({ data: { session: SESSION } });
    await expect(getSession()).resolves.toBe(SESSION);
    await expect(getAccessToken()).resolves.toBe('sb-access');
    // 第二次走缓存，不再调 supabase
    await expect(getAccessToken()).resolves.toBe('sb-access');
    expect(authApi.getSession).toHaveBeenCalledTimes(1);
  });

  it('signIn delegates to supabase and caches the session', async () => {
    stubAuthEnv();
    authApi.signInWithPassword.mockResolvedValue({ data: { session: SESSION }, error: null });
    await expect(signIn('a@b.c', 'pw')).resolves.toBe(SESSION);
    expect(authApi.signInWithPassword).toHaveBeenCalledWith({ email: 'a@b.c', password: 'pw' });
    await expect(getAccessToken()).resolves.toBe('sb-access');
  });

  it('signIn throws on supabase error', async () => {
    stubAuthEnv();
    authApi.signInWithPassword.mockResolvedValue({ data: { session: null }, error: new Error('invalid') });
    await expect(signIn('a@b.c', 'pw')).rejects.toThrow('invalid');
  });

  it('signUp delegates to supabase', async () => {
    stubAuthEnv();
    authApi.signUp.mockResolvedValue({ data: { session: null }, error: null });
    await expect(signUp('a@b.c', 'pw')).resolves.toBeNull();
    expect(authApi.signUp).toHaveBeenCalledWith({ email: 'a@b.c', password: 'pw' });
  });

  it('refreshSession returns the new access token', async () => {
    stubAuthEnv();
    authApi.refreshSession.mockResolvedValue({ data: { session: SESSION }, error: null });
    await expect(refreshSession()).resolves.toBe('sb-access');
  });

  it('refreshSession returns null on failure', async () => {
    stubAuthEnv();
    authApi.refreshSession.mockResolvedValue({ data: { session: null }, error: new Error('expired') });
    await expect(refreshSession()).resolves.toBeNull();
    authApi.refreshSession.mockRejectedValue(new Error('network'));
    await expect(refreshSession()).resolves.toBeNull();
  });

  it('signOut clears the cached session', async () => {
    stubAuthEnv();
    authApi.getSession.mockResolvedValue({ data: { session: SESSION } });
    await getSession();
    await signOut();
    expect(authApi.signOut).toHaveBeenCalled();
    authApi.getSession.mockResolvedValue({ data: { session: null } });
    await expect(getAccessToken()).resolves.toBeNull();
  });
});

describe('onAuthStateChange', () => {
  it('forwards session updates to the callback and returns an unsubscribe', () => {
    stubAuthEnv();
    const unsubscribe = vi.fn();
    let captured: ((event: string, session: unknown) => void) | undefined;
    authApi.onAuthStateChange.mockImplementation((cb: (event: string, session: unknown) => void) => {
      captured = cb;
      return { data: { subscription: { unsubscribe } } };
    });
    const callback = vi.fn();
    const off = onAuthStateChange(callback);
    captured?.('SIGNED_IN', SESSION);
    expect(callback).toHaveBeenCalledWith(SESSION);
    off();
    expect(unsubscribe).toHaveBeenCalled();
  });
});
