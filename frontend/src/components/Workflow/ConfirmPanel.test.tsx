import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmPanel } from './ConfirmPanel';

const interrupt = {
  kind: 'confirm_overwrite' as const,
  stats: {
    chapters: 3,
    segments: 12,
    synthesized_segments: 8,
    has_animation_brief: true,
  },
  available_actions: ['confirm', 'cancel'],
};

describe('ConfirmPanel', () => {
  it('renders stats and warning', () => {
    render(<ConfirmPanel interrupt={interrupt} onRespond={() => {}} />);
    expect(screen.getByText(/3 个章节/)).toBeTruthy();
    expect(screen.getByText(/8 段已合成音频/)).toBeTruthy();
    expect(screen.getByText(/删除并重建/)).toBeTruthy();
  });

  it('confirm button responds with confirm action', () => {
    const onRespond = vi.fn();
    render(<ConfirmPanel interrupt={interrupt} onRespond={onRespond} />);
    fireEvent.click(screen.getByText('确认重建'));
    expect(onRespond).toHaveBeenCalledWith({ action: 'confirm' });
  });

  it('cancel button responds with cancel action', () => {
    const onRespond = vi.fn();
    render(<ConfirmPanel interrupt={interrupt} onRespond={onRespond} />);
    fireEvent.click(screen.getByText('取消'));
    expect(onRespond).toHaveBeenCalledWith({ action: 'cancel' });
  });
});
