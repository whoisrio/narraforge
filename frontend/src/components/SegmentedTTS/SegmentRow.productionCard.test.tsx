import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Segment } from '../../types';
import { SegmentRow } from './SegmentRow';

const segment: Segment = {
  id: 's1',
  text: '这是一个生产卡片分段',
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
  const onRegenerate = vi.fn();
  const onDelete = vi.fn();
  render(
    <SegmentRow
      segment={segment}
      index={1}
      isSelected={false}
      isPlaying={false}
      isPaused={false}
      compact
      voices={[]}
      roles={[]}
      globalEdgeVoice="zh-CN-YunxiNeural"
      engine="edge_tts"
      layout="vertical"
      onSelect={onSelect}
      onDelete={onDelete}
      onEdit={vi.fn()}
      onRegenerate={onRegenerate}
      onPlay={vi.fn()}
      onUndo={vi.fn()}
      isLast
      {...overrides}
    />,
  );
  return { onSelect, onRegenerate, onDelete };
}

describe('SegmentRow production card semantics', () => {
  it('does not expose the whole production card as a button when inner controls exist', () => {
    const { onSelect, onRegenerate, onDelete } = renderRow();

    expect(screen.queryByRole('button', { name: /这是一个生产卡片分段/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(2);

    fireEvent.click(screen.getByText('这是一个生产卡片分段'));
    expect(onSelect).toHaveBeenCalledWith('s1');

    fireEvent.click(screen.getByRole('button', { name: '▶' }));
    expect(onRegenerate).toHaveBeenCalledWith('s1');

    fireEvent.click(screen.getByRole('button', { name: '✕' }));
    expect(onDelete).toHaveBeenCalledWith('s1');
  });
});
