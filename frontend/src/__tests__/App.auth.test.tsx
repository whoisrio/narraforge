import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { setToken } from '../services/auth';

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

vi.mock('../pages/Landing', () => ({
  default: () => <div data-testid="page-landing" />,
}));

beforeEach(() => {
  localStorage.clear();
  vi.stubEnv('VITE_AUTH_REQUIRED', 'true');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('App auth gating (VITE_AUTH_REQUIRED=true)', () => {
  it('renders the unlock gate instead of the main UI when no token is stored', () => {
    render(<App />);
    expect(screen.getByTestId('unlock-gate')).toBeInTheDocument();
    expect(screen.queryByTestId('page-landing')).not.toBeInTheDocument();
  });

  it('renders the main UI when a token is stored', () => {
    setToken('tok123');
    render(<App />);
    expect(screen.queryByTestId('unlock-gate')).not.toBeInTheDocument();
    expect(screen.getByTestId('page-landing')).toBeInTheDocument();
  });
});
