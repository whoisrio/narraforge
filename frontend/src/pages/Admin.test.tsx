import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/adminApi', () => ({
  adminApi: {
    getOverview: vi.fn(),
    getUsers: vi.fn(),
    getLogs: vi.fn(),
  },
  errorStatus: (err: unknown) => (err as { response?: { status?: number } })?.response?.status ?? null,
}));

import { Admin } from './Admin';
import { AuthContext, type AuthContextValue } from '../hooks/authContext';
import { adminApi } from '../services/adminApi';

const mockedGetOverview = vi.mocked(adminApi.getOverview);
const mockedGetUsers = vi.mocked(adminApi.getUsers);
const mockedGetLogs = vi.mocked(adminApi.getLogs);

const OVERVIEW = {
  total_users: 42,
  today_dau: 7,
  dau_series: [
    { date: '2026-08-15', count: 3 },
    { date: '2026-08-16', count: 7 },
  ],
  visit_series: [
    { date: '2026-08-15', authed: 5, anon: 9 },
    { date: '2026-08-16', authed: 8, anon: 4 },
  ],
};

const USERS_PAGE = {
  items: [
    { id: 'u1', email: 'admin@example.com', created_at: '2026-08-01T00:00:00Z', last_seen_at: '2026-08-16T10:00:00Z', is_admin: true },
    { id: 'u2', email: 'user@example.com', created_at: '2026-08-02T00:00:00Z', last_seen_at: null, is_admin: false },
  ],
  total: 40,
  page: 1,
  page_size: 20,
};

const LOGS_PAGE = {
  items: [
    { id: 'l1', user_id: 'u1', action: 'tts.synthesize', method: 'POST', path: '/api/tts/synthesize', status: 200, duration_ms: 123, created_at: '2026-08-16T10:00:00Z' },
  ],
  total: 1,
  page: 1,
  page_size: 20,
};

function renderAdmin(isAdmin: boolean) {
  const value: AuthContextValue = {
    user: isAdmin ? { id: 'u1', email: 'admin@example.com' } : { id: 'u2', email: 'user@example.com' },
    isAdmin,
    isAnonymous: false,
    loading: false,
    sessionExpired: false,
    signIn: vi.fn(),
    signUp: vi.fn(),
    signOut: vi.fn(),
    clearSessionExpired: vi.fn(),
  };
  return render(<AuthContext.Provider value={value}><Admin /></AuthContext.Provider>);
}

beforeEach(() => {
  mockedGetOverview.mockResolvedValue(OVERVIEW);
  mockedGetUsers.mockResolvedValue(USERS_PAGE);
  mockedGetLogs.mockResolvedValue(LOGS_PAGE);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('Admin page', () => {
  it('renders overview cards, trend charts, users table and logs table', async () => {
    renderAdmin(true);
    expect(await screen.findByTestId('admin-total-users')).toHaveTextContent('42');
    expect(screen.getByTestId('admin-today-dau')).toHaveTextContent('7');
    expect(screen.getByTestId('admin-dau-chart')).toBeInTheDocument();
    expect(screen.getByTestId('admin-visit-chart')).toBeInTheDocument();

    expect(await screen.findByText('admin@example.com')).toBeInTheDocument();
    expect(screen.getByText('user@example.com')).toBeInTheDocument();
    expect(screen.getByText('管理员')).toBeInTheDocument();

    expect(await screen.findByText('tts.synthesize')).toBeInTheDocument();
    expect(screen.getByText('POST /api/tts/synthesize')).toBeInTheDocument();
    expect(screen.getByText('123ms')).toBeInTheDocument();
  });

  it('shows the forbidden state for non-admin users without calling the API', () => {
    renderAdmin(false);
    expect(screen.getByTestId('admin-forbidden')).toHaveTextContent('无权限访问管理后台');
    expect(mockedGetOverview).not.toHaveBeenCalled();
  });

  it('shows the forbidden state when the API returns 403', async () => {
    mockedGetOverview.mockRejectedValue(Object.assign(new Error('forbidden'), { response: { status: 403 } }));
    mockedGetUsers.mockRejectedValue(Object.assign(new Error('forbidden'), { response: { status: 403 } }));
    mockedGetLogs.mockRejectedValue(Object.assign(new Error('forbidden'), { response: { status: 403 } }));
    renderAdmin(true);
    await waitFor(() => expect(screen.getAllByText('无权限访问管理后台').length).toBeGreaterThan(0));
  });

  it('paginates the users table', async () => {
    renderAdmin(true);
    await screen.findByText('admin@example.com');
    mockedGetUsers.mockResolvedValue({ ...USERS_PAGE, page: 2, total: 40, items: [] });
    fireEvent.click(screen.getAllByRole('button', { name: '下一页' })[0]);
    await waitFor(() => expect(mockedGetUsers).toHaveBeenCalledWith(2, 20));
  });

  it('applies log filters', async () => {
    renderAdmin(true);
    await screen.findByText('tts.synthesize');
    fireEvent.change(screen.getByPlaceholderText('按操作过滤…'), { target: { value: 'tts' } });
    fireEvent.click(screen.getByRole('button', { name: '筛选' }));
    await waitFor(() => expect(mockedGetLogs).toHaveBeenCalledWith(1, 20, { action: 'tts', date: undefined }));
  });
});
