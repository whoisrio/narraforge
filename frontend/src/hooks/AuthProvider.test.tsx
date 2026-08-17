import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/authSession', () => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(() => () => undefined),
  signIn: vi.fn(),
  signUp: vi.fn(),
  signOut: vi.fn(),
  signOutLocal: vi.fn(),
  getAccessToken: vi.fn(),
  refreshSession: vi.fn(),
}));

vi.mock('../services/adminApi', () => ({
  adminApi: {
    getOverview: vi.fn(),
    getUsers: vi.fn(),
    getLogs: vi.fn(),
  },
  errorStatus: (err: unknown) => (err as { response?: { status?: number } })?.response?.status ?? null,
}));

import { AuthProvider } from './AuthProvider';
import { useAuth } from './authContext';
import * as authSession from '../services/authSession';
import { adminApi } from '../services/adminApi';

const mockedGetSession = vi.mocked(authSession.getSession);
const mockedGetOverview = vi.mocked(adminApi.getOverview);

const SESSION = {
  access_token: 'sb-access',
  user: { id: 'u1', email: 'admin@example.com' },
} as never;

function forbiddenError() {
  return Object.assign(new Error('forbidden'), { response: { status: 403 } });
}

beforeEach(() => {
  vi.stubEnv('VITE_AUTH_REQUIRED', 'true');
  mockedGetSession.mockResolvedValue(null);
  mockedGetOverview.mockRejectedValue(forbiddenError());
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('AuthProvider', () => {
  it('starts anonymous when there is no session', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.user).toBeNull();
    expect(result.current.isAnonymous).toBe(true);
    expect(result.current.isAdmin).toBe(false);
    expect(mockedGetOverview).not.toHaveBeenCalled();
  });

  it('restores the session and probes admin (403 → not admin)', async () => {
    mockedGetSession.mockResolvedValue(SESSION);
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.user?.email).toBe('admin@example.com'));
    expect(result.current.isAnonymous).toBe(false);
    await waitFor(() => expect(mockedGetOverview).toHaveBeenCalled());
    await waitFor(() => expect(result.current.isAdmin).toBe(false));
  });

  it('marks the user as admin when the overview probe succeeds', async () => {
    mockedGetSession.mockResolvedValue(SESSION);
    mockedGetOverview.mockResolvedValue({
      total_users: 1,
      today_dau: 1,
      dau_series: [],
      visit_series: [],
    });
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.isAdmin).toBe(true));
  });

  it('signIn sets the user from the returned session', async () => {
    vi.mocked(authSession.signIn).mockResolvedValue(SESSION);
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await result.current.signIn('admin@example.com', 'pw');
    expect(authSession.signIn).toHaveBeenCalledWith('admin@example.com', 'pw');
    await waitFor(() => expect(result.current.user?.email).toBe('admin@example.com'));
  });

  it('signUp returns true when email confirmation is required (no session)', async () => {
    vi.mocked(authSession.signUp).mockResolvedValue(null);
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await expect(result.current.signUp('a@b.c', 'pw')).resolves.toBe(true);
    expect(result.current.user).toBeNull();
  });

  it('signOut clears the user', async () => {
    mockedGetSession.mockResolvedValue(SESSION);
    vi.mocked(authSession.signOut).mockResolvedValue(undefined);
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.user).not.toBeNull());
    await result.current.signOut();
    await waitFor(() => expect(result.current.user).toBeNull());
    expect(result.current.isAnonymous).toBe(true);
  });
});
