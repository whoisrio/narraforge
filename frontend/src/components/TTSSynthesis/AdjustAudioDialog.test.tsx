import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../../i18n', () => ({
  useTranslation: () => ({ t: (k: string, p?: Record<string, unknown>) => (p ? `${k}:${JSON.stringify(p)}` : k), locale: 'zh-CN', setLocale: () => {} }),
}));

afterEach(() => cleanup());

import { AdjustAudioDialog } from './AdjustAudioDialog';

const baseProps = { readyCount: 3, onCancel: vi.fn(), onConfirm: vi.fn() };

describe('AdjustAudioDialog', () => {
  it('shows affected count and both sliders', () => {
    render(<AdjustAudioDialog {...baseProps} />);
    expect(screen.getByText(/adjustAudio.affected/)).toBeInTheDocument();
    expect(screen.getByLabelText('adjustAudio.tempo')).toBeInTheDocument();
    expect(screen.getByLabelText('adjustAudio.volume')).toBeInTheDocument();
  });

  it('confirm disabled at identity (1.0x / 0dB), enabled after change', () => {
    render(<AdjustAudioDialog {...baseProps} />);
    const apply = screen.getByText('adjustAudio.apply');
    expect(apply).toBeDisabled();
    fireEvent.change(screen.getByLabelText('adjustAudio.tempo'), { target: { value: '1.5' } });
    expect(apply).toBeEnabled();
  });

  it('confirm passes tempo and volume values', () => {
    const onConfirm = vi.fn();
    render(<AdjustAudioDialog {...baseProps} onConfirm={onConfirm} />);
    fireEvent.change(screen.getByLabelText('adjustAudio.tempo'), { target: { value: '1.5' } });
    fireEvent.change(screen.getByLabelText('adjustAudio.volume'), { target: { value: '3' } });
    fireEvent.click(screen.getByText('adjustAudio.apply'));
    expect(onConfirm).toHaveBeenCalledWith(1.5, 3);
  });

  it('disabled when no ready segments', () => {
    render(<AdjustAudioDialog {...baseProps} readyCount={0} />);
    fireEvent.change(screen.getByLabelText('adjustAudio.tempo'), { target: { value: '1.5' } });
    expect(screen.getByText('adjustAudio.apply')).toBeDisabled();
  });
});

describe('AdjustAudioDialog with existing record', () => {
  const record = { tempo: 1.5, volume_db: 3 };

  it('initializes sliders from the record and shows current params', () => {
    render(<AdjustAudioDialog {...baseProps} currentAdjust={record} />);
    expect(screen.getByLabelText('adjustAudio.tempo')).toHaveValue('1.5');
    expect(screen.getByLabelText('adjustAudio.volume')).toHaveValue('3');
    expect(screen.getByText(/adjustAudio.current/)).toBeInTheDocument();
  });

  it('disables apply when params unchanged, enables revert at identity', () => {
    render(<AdjustAudioDialog {...baseProps} currentAdjust={record} />);
    expect(screen.getByText('adjustAudio.apply')).toBeDisabled();
    fireEvent.change(screen.getByLabelText('adjustAudio.tempo'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('adjustAudio.volume'), { target: { value: '0' } });
    const revert = screen.getByText('adjustAudio.revert');
    expect(revert).toBeEnabled();
  });
});
