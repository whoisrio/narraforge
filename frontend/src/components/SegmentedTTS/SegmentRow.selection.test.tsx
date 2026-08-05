import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Segment } from '../../types';
import { SegmentRow } from './SegmentRow';

const segment: Segment = {
  id: 's1',
  text: '这是一个多选分段',
  voice: { source: 'chapter' },
  audio: { format: 'mp3' },
  params: { engine: 'edge_tts' as const, edge_voice: 'zh-CN-YunxiNeural' },
  status: 'idle',
  segment_kind: 'narration',
  created_at: '2026-01-01',
  updated_at: '2026-01-01',
};

function renderRow(overrides: Partial<React.ComponentProps<typeof SegmentRow>> = {}) {
  const onSelect = vi.fn();
  const onToggleSelect = vi.fn();
  render(
    <SegmentRow
      segment={segment}
      index={1}
      isSelected={false}
      isPlaying={false}
      isPaused={false}
      voices={[]}
      roles={[]}
      globalEdgeVoice="zh-CN-YunxiNeural"
      engine="edge_tts"
      layout="vertical"
      onSelect={onSelect}
      onToggleSelect={onToggleSelect}
      onDelete={vi.fn()}
      onEdit={vi.fn()}
      onRegenerate={vi.fn()}
      onPlay={vi.fn()}
      onUndo={vi.fn()}
      isLast
      {...overrides}
    />,
  );
  return { onSelect, onToggleSelect };
}

describe('SegmentRow multi-select', () => {
  it('renders no checkbox when selectionMode is off', () => {
    renderRow({ compact: true });
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('compact row: checkbox toggles selection without triggering row select', () => {
    const { onSelect, onToggleSelect } = renderRow({ compact: true, selectionMode: true, selected: false });

    const checkbox = screen.getByRole('checkbox');
    expect(checkbox).not.toBeChecked();

    fireEvent.click(checkbox);
    expect(onToggleSelect).toHaveBeenCalledWith('s1');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('compact row: checked state comes from the selected prop', () => {
    renderRow({ compact: true, selectionMode: true, selected: true });
    expect(screen.getByRole('checkbox')).toBeChecked();
  });

  it('expanded row: checkbox toggles selection without triggering row select', () => {
    const { onSelect, onToggleSelect } = renderRow({ compact: false, selectionMode: true, selected: true });

    const checkbox = screen.getByRole('checkbox');
    expect(checkbox).toBeChecked();

    fireEvent.click(checkbox);
    expect(onToggleSelect).toHaveBeenCalledWith('s1');
    expect(onSelect).not.toHaveBeenCalled();
  });
});
