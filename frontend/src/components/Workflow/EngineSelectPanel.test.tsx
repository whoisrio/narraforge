import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EngineSelectPanel } from './EngineSelectPanel';
import type { SelectEngineInterrupt } from '../../services/langgraph/types';

const interrupt: SelectEngineInterrupt = {
  kind: 'select_tts_engine',
  available_engines: ['edge_tts', 'voxcpm', 'mimo_tts'],
  default_engine: 'voxcpm',
  timeout_s: 5,
};

describe('EngineSelectPanel', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('pre-selects the default engine and describes tag capabilities', () => {
    render(<EngineSelectPanel interrupt={interrupt} onRespond={() => {}} />);
    expect(screen.getByText('默认')).toBeTruthy();
    expect(screen.getByText('位置 tag + 开头风格')).toBeTruthy();
    expect(screen.getByText('不支持')).toBeTruthy();
    expect(screen.getByText('开头风格标签')).toBeTruthy();
  });

  it('auto-responds with the default engine when the countdown expires', () => {
    const onRespond = vi.fn();
    render(<EngineSelectPanel interrupt={interrupt} onRespond={onRespond} />);

    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(onRespond).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(onRespond).toHaveBeenCalledTimes(1);
    expect(onRespond).toHaveBeenCalledWith({ engine: 'voxcpm' });
  });

  it('stops the countdown after a manual selection and submits the selected engine', () => {
    const onRespond = vi.fn();
    render(<EngineSelectPanel interrupt={interrupt} onRespond={onRespond} />);

    fireEvent.click(screen.getByText('Edge-TTS'));

    // 倒计时已停止：超过 timeout_s 也不会自动提交
    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(onRespond).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /确认/ }));
    expect(onRespond).toHaveBeenCalledTimes(1);
    expect(onRespond).toHaveBeenCalledWith({ engine: 'edge_tts' });
  });
});
