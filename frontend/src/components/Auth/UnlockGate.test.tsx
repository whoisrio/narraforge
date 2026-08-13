import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('axios', () => ({
  default: { get: vi.fn() },
}));

import axios from 'axios';
import { TranslationProvider } from '../../i18n';
import { getToken } from '../../services/auth';
import { UnlockGate } from './UnlockGate';

function renderGate(onUnlocked = vi.fn()) {
  render(
    <TranslationProvider>
      <UnlockGate onUnlocked={onUnlocked} />
    </TranslationProvider>,
  );
  return onUnlocked;
}

function submitToken(value: string) {
  fireEvent.change(screen.getByTestId('unlock-token-input'), { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: /解锁|Unlock/ }));
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('UnlockGate', () => {
  it('verifies the token against the backend and unlocks on success', async () => {
    vi.mocked(axios.get).mockResolvedValue({ data: {} });
    const onUnlocked = renderGate();

    submitToken('tok123');

    await waitFor(() => expect(onUnlocked).toHaveBeenCalled());
    expect(axios.get).toHaveBeenCalledWith(
      '/api/config/capabilities',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer tok123' }),
      }),
    );
    // 验证通过后才持久化口令
    expect(getToken()).toBe('tok123');
  });

  it('shows an error and keeps the token out of storage on 401', async () => {
    vi.mocked(axios.get).mockRejectedValue({ response: { status: 401 } });
    const onUnlocked = renderGate();

    submitToken('wrong');

    expect(await screen.findByText(/口令错误/)).toBeInTheDocument();
    expect(onUnlocked).not.toHaveBeenCalled();
    expect(getToken()).toBeNull();
  });

  it('shows a generic error when verification fails for other reasons', async () => {
    vi.mocked(axios.get).mockRejectedValue(new Error('network down'));
    const onUnlocked = renderGate();

    submitToken('tok123');

    expect(await screen.findByText(/验证失败/)).toBeInTheDocument();
    expect(onUnlocked).not.toHaveBeenCalled();
    expect(getToken()).toBeNull();
  });
});
