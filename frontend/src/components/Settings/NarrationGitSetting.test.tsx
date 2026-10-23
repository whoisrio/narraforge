import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

const { getGitRemote, setGitRemote, snapshotNarrationGit } = vi.hoisted(() => ({
  getGitRemote: vi.fn(),
  setGitRemote: vi.fn(),
  snapshotNarrationGit: vi.fn(),
}));

vi.mock('../../services/api', () => ({
  configApi: {
    getNarrationGitRemote: getGitRemote,
    setNarrationGitRemote: setGitRemote,
    snapshotNarrationGit: snapshotNarrationGit,
  },
}));

vi.mock('../../i18n', () => {
  // Keep `t` stable across renders, like the real provider. Otherwise a stale
  // useCallback closure is masked and tests pass even when deps are missing.
  const t = (k: string) => k;
  return { useTranslation: () => ({ t, locale: 'zh-CN', setLocale: () => {} }) };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

import { NarrationGitSetting } from './NarrationGitSetting';

describe('NarrationGitSetting', () => {
  it('loads and displays the current remote on mount', async () => {
    getGitRemote.mockResolvedValue({ value: 'https://github.com/me/r.git' });
    render(<NarrationGitSetting />);
    await waitFor(() => {
      expect((screen.getByLabelText('settings.narrationGit.label') as HTMLInputElement).value)
        .toBe('https://github.com/me/r.git');
    });
  });

  it('does not let a late initial load overwrite the user input', async () => {
    let resolveGet: (value: { value: string | null }) => void = () => {};
    getGitRemote.mockReturnValue(new Promise((resolve) => { resolveGet = resolve; }));
    render(<NarrationGitSetting />);

    const input = screen.getByLabelText('settings.narrationGit.label') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'git@host:typed.git' } });

    await act(async () => { resolveGet({ value: 'git@host:stale.git' }); });

    expect(input.value).toBe('git@host:typed.git');
  });

  it('save calls setNarrationGitRemote and shows success', async () => {
    getGitRemote.mockResolvedValue({ value: null });
    setGitRemote.mockResolvedValue({ value: 'git@host:r.git' });
    render(<NarrationGitSetting />);
    await waitFor(() => expect(getGitRemote).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText('settings.narrationGit.label'), { target: { value: 'git@host:r.git' } });
    fireEvent.click(screen.getByText('common.save'));

    await waitFor(() => expect(setGitRemote).toHaveBeenCalledWith('git@host:r.git'));
    await waitFor(() => expect(screen.getByText('settings.narrationGit.saveSuccess')).toBeInTheDocument());
  });

  it('snapshot button calls snapshotNarrationGit and shows pushed result', async () => {
    getGitRemote.mockResolvedValue({ value: 'git@host:r.git' });
    snapshotNarrationGit.mockResolvedValue({
      commit_sha: 'abc12345', projects: 3, pushed: true, push_error: null, remote_configured: true,
    });
    render(<NarrationGitSetting />);
    await waitFor(() => expect(getGitRemote).toHaveBeenCalled());

    fireEvent.click(screen.getByText('settings.narrationGit.snapshot'));

    await waitFor(() => expect(snapshotNarrationGit).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText(/abc12345/)).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('settings.narrationGit.pushed')).toBeInTheDocument());
  });

  it('snapshot uses the current input even when it was not saved first', async () => {
    getGitRemote.mockResolvedValue({ value: null });
    snapshotNarrationGit.mockResolvedValue({
      commit_sha: 'abc12345', projects: 3, pushed: true, push_error: null, remote_configured: true,
    });
    render(<NarrationGitSetting />);
    await waitFor(() => expect(getGitRemote).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText('settings.narrationGit.label'), {
      target: { value: '  git@host:current.git  ' },
    });
    fireEvent.click(screen.getByText('settings.narrationGit.snapshot'));

    await waitFor(() => expect(snapshotNarrationGit).toHaveBeenCalledWith('git@host:current.git'));
    await waitFor(() => expect(screen.getByText('settings.narrationGit.pushed')).toBeInTheDocument());
  });

  it('snapshot reports a configured remote that was not pushed', async () => {
    getGitRemote.mockResolvedValue({ value: 'git@host:r.git' });
    snapshotNarrationGit.mockResolvedValue({
      commit_sha: 'abc12345', projects: 3, pushed: false, push_error: null, remote_configured: true,
    });
    render(<NarrationGitSetting />);
    await waitFor(() => expect(getGitRemote).toHaveBeenCalled());

    fireEvent.click(screen.getByText('settings.narrationGit.snapshot'));
    await waitFor(() => expect(screen.getByText('settings.narrationGit.notPushed')).toBeInTheDocument());
  });

  it('snapshot shows push error when push failed', async () => {
    getGitRemote.mockResolvedValue({ value: 'git@host:r.git' });
    snapshotNarrationGit.mockResolvedValue({
      commit_sha: 'abc12345', projects: 3, pushed: false, push_error: 'non-fast-forward', remote_configured: true,
    });
    render(<NarrationGitSetting />);
    await waitFor(() => expect(getGitRemote).toHaveBeenCalled());

    fireEvent.click(screen.getByText('settings.narrationGit.snapshot'));
    await waitFor(() => expect(screen.getByText(/non-fast-forward/)).toBeInTheDocument());
  });
});
