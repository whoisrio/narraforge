import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

const { getAnimationRoot, setAnimationRoot, testAnimationRoot } = vi.hoisted(() => ({
  getAnimationRoot: vi.fn(),
  setAnimationRoot: vi.fn(),
  testAnimationRoot: vi.fn(),
}));

vi.mock('../../services/api', () => ({
  configApi: {
    getAnimationRoot,
    setAnimationRoot,
    testAnimationRoot,
  },
}));

vi.mock('../../i18n', () => ({
  useTranslation: () => ({ t: (k: string) => k, locale: 'zh-CN', setLocale: () => {} }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

import { AnimationRootSetting } from './AnimationRootSetting';

describe('AnimationRootSetting', () => {
  it('loads and displays the current value on mount', async () => {
    getAnimationRoot.mockResolvedValue({ value: '/existing/root' });
    render(<AnimationRootSetting />);
    await waitFor(() => {
      expect((screen.getByLabelText('settings.animationRoot.label') as HTMLInputElement).value).toBe('/existing/root');
    });
  });

  it('save calls setAnimationRoot and shows success', async () => {
    getAnimationRoot.mockResolvedValue({ value: null });
    setAnimationRoot.mockResolvedValue({ value: '/new/root' });
    render(<AnimationRootSetting />);
    await waitFor(() => expect(getAnimationRoot).toHaveBeenCalled());

    const input = screen.getByLabelText('settings.animationRoot.label') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '/new/root' } });
    fireEvent.click(screen.getByText('common.save'));

    await waitFor(() => expect(setAnimationRoot).toHaveBeenCalledWith('/new/root'));
    await waitFor(() => expect(screen.getByText('settings.animationRoot.saveSuccess')).toBeInTheDocument());
  });

  it('save on 422 shows the backend error detail', async () => {
    getAnimationRoot.mockResolvedValue({ value: null });
    setAnimationRoot.mockRejectedValue({
      response: { status: 422, data: { detail: 'cannot_create_directory: boom' } },
    });
    render(<AnimationRootSetting />);
    await waitFor(() => expect(getAnimationRoot).toHaveBeenCalled());

    const input = screen.getByLabelText('settings.animationRoot.label') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '/bad/path' } });
    fireEvent.click(screen.getByText('common.save'));

    await waitFor(() => expect(setAnimationRoot).toHaveBeenCalledWith('/bad/path'));
    await waitFor(() => expect(screen.getByText(/cannot_create_directory: boom/)).toBeInTheDocument());
  });

  it('test button calls testAnimationRoot and shows ok', async () => {
    getAnimationRoot.mockResolvedValue({ value: null });
    testAnimationRoot.mockResolvedValue({ ok: true, error: null });
    render(<AnimationRootSetting />);
    await waitFor(() => expect(getAnimationRoot).toHaveBeenCalled());

    const input = screen.getByLabelText('settings.animationRoot.label') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '/probe' } });
    fireEvent.click(screen.getByText('settings.animationRoot.test'));

    await waitFor(() => expect(testAnimationRoot).toHaveBeenCalledWith('/probe'));
    await waitFor(() => expect(screen.getByText('settings.animationRoot.testOk')).toBeInTheDocument());
  });

  it('test button shows error when path unusable', async () => {
    getAnimationRoot.mockResolvedValue({ value: null });
    testAnimationRoot.mockResolvedValue({ ok: false, error: 'cannot_create_directory: nope' });
    render(<AnimationRootSetting />);
    await waitFor(() => expect(getAnimationRoot).toHaveBeenCalled());

    const input = screen.getByLabelText('settings.animationRoot.label') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '/bad' } });
    fireEvent.click(screen.getByText('settings.animationRoot.test'));

    await waitFor(() => expect(testAnimationRoot).toHaveBeenCalledWith('/bad'));
    await waitFor(() => expect(screen.getByText(/cannot_create_directory: nope/)).toBeInTheDocument());
  });
});
