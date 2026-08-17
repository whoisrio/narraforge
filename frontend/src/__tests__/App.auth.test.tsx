import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

vi.mock('../services/capabilities', async (importOriginal) => {
  const original = await importOriginal<typeof import('../services/capabilities')>();
  return {
    ...original,
    fetchCapabilities: vi.fn().mockResolvedValue(original.LOCAL_CAPABILITIES),
  };
});

vi.mock('../services/api', () => ({
  configApi: {
    getStorageMode: vi.fn().mockResolvedValue({ storage_mode: 'frontend' }),
    setStorageMode: vi.fn().mockResolvedValue({ storage_mode: 'frontend' }),
  },
}));

vi.mock('../services/segmentedProjectStorage', () => ({
  indexedDBStorage: {
    listProjects: vi.fn().mockResolvedValue([]),
    getProject: vi.fn(),
    saveProject: vi.fn(),
    deleteProject: vi.fn(),
  },
}));

vi.mock('../services/backendSegmentedProjectStorage', () => ({
  backendStorage: {
    listProjects: vi.fn().mockResolvedValue([]),
    getProject: vi.fn(),
    saveProject: vi.fn(),
    deleteProject: vi.fn(),
  },
}));

vi.mock('../components/ProjectHub/ProjectHub', () => ({
  ProjectHub: () => <div data-testid="project-hub" />,
}));

vi.mock('../pages/TTSSynthesis', () => ({
  TTSSynthesis: () => <div data-testid="page-tts-synthesis" />,
}));
vi.mock('../pages/VoiceClone', () => ({
  VoiceClone: () => <div data-testid="page-voice-design" />,
}));
vi.mock('../pages/SpeechToText', () => ({
  SpeechToText: () => <div data-testid="page-subtitles" />,
}));
vi.mock('../pages/ModelConfig', () => ({
  ModelConfig: () => <div data-testid="page-settings" />,
}));
vi.mock('../pages/Admin', () => ({
  Admin: () => <div data-testid="page-admin" />,
}));

vi.mock('../pages/Landing', () => ({
  default: ({ onNavigate }: { onNavigate: (tab: 'tts-synthesis') => void }) => (
    <div data-testid="page-landing">
      <button type="button" onClick={() => onNavigate('tts-synthesis')}>进入工作台</button>
    </div>
  ),
}));

import App from '../App';
import * as authSession from '../services/authSession';
import { adminApi } from '../services/adminApi';

const mockedGetSession = vi.mocked(authSession.getSession);
const mockedGetOverview = vi.mocked(adminApi.getOverview);

const SESSION = {
  access_token: 'sb-access',
  user: { id: 'u1', email: 'user@example.com' },
} as never;

beforeEach(() => {
  localStorage.clear();
  vi.stubEnv('VITE_AUTH_REQUIRED', 'true');
  mockedGetSession.mockResolvedValue(null);
  mockedGetOverview.mockRejectedValue(Object.assign(new Error('forbidden'), { response: { status: 403 } }));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('App auth (VITE_AUTH_REQUIRED=true)', () => {
  it('anonymous users land on the landing page with the anonymous banner (no unlock gate)', async () => {
    render(<App />);
    expect(await screen.findByTestId('page-landing')).toBeInTheDocument();
    expect(screen.getByTestId('anon-banner')).toBeInTheDocument();
    expect(screen.queryByTestId('unlock-gate')).not.toBeInTheDocument();
  });

  it('anonymous users can dismiss the banner to continue anonymously', async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: '继续使用匿名模式' }));
    expect(screen.queryByTestId('anon-banner')).not.toBeInTheDocument();
    expect(screen.getByTestId('page-landing')).toBeInTheDocument();
  });

  it('anonymous users can open the login page from the banner', async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: '登录' }));
    expect(await screen.findByTestId('auth-page')).toBeInTheDocument();
    expect(screen.queryByTestId('page-landing')).not.toBeInTheDocument();
  });

  it('anonymous mode hides gated nav entries, the backend storage option and shows a header login button', async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: '进入工作台' }));
    expect(await screen.findByTestId('app-shell')).toBeInTheDocument();
    expect(screen.getByTestId('header-login-button')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /字幕识别/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /音色设计/ })).not.toBeInTheDocument();
    // LOCAL_CAPABILITIES 下 backend_storage=true，但匿名用户不给出 backend 选项
    expect(screen.queryByRole('option', { name: /后端存储/ })).not.toBeInTheDocument();
  });

  it('signed-in users see no banner and get the user menu; nav entries stay visible', async () => {
    mockedGetSession.mockResolvedValue(SESSION);
    render(<App />);
    expect(await screen.findByTestId('page-landing')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId('anon-banner')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '进入工作台' }));
    expect(await screen.findByTestId('user-menu-trigger')).toHaveTextContent('user@example.com');
    expect(screen.getByRole('button', { name: /字幕识别/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /音色设计/ })).toBeInTheDocument();
    // 非管理员：菜单里没有管理后台入口
    fireEvent.click(screen.getByTestId('user-menu-trigger'));
    expect(screen.queryByRole('button', { name: '管理后台' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '登出' })).toBeInTheDocument();
  });

  it('admin users get the admin entry which opens the admin page', async () => {
    mockedGetSession.mockResolvedValue(SESSION);
    mockedGetOverview.mockResolvedValue({ total_users: 1, today_dau: 1, dau_series: [], visit_series: [] });
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: '进入工作台' }));
    fireEvent.click(await screen.findByTestId('user-menu-trigger'));
    fireEvent.click(await screen.findByRole('button', { name: '管理后台' }));
    expect(await screen.findByTestId('page-admin')).toBeInTheDocument();
  });
});
