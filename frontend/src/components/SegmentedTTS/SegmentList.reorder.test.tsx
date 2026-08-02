import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Segment } from '../../types';
import { SegmentList } from './SegmentList';

function makeSegment(id: string): Segment {
  return {
    id,
    text: id,
    voice: { source: 'chapter' },
    audio: { format: 'mp3' },
    status: 'idle',
    segment_kind: 'narration',
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
  };
}

function renderList(segments: Segment[], overrides: Partial<React.ComponentProps<typeof SegmentList>> = {}) {
  return render(
    <SegmentList
      segments={segments}
      layout="vertical"
      selectedId={undefined}
      playingId={undefined}
      compact
      voices={[]}
      engine="edge_tts"
      onSelect={vi.fn()}
      onDelete={vi.fn()}
      onInsertAfter={vi.fn()}
      onAppend={vi.fn()}
      onReorder={vi.fn()}
      onEdit={vi.fn()}
      onRegenerate={vi.fn()}
      onPlay={vi.fn()}
      onUndo={vi.fn()}
      {...overrides}
    />,
  );
}

describe('SegmentList reorder controls', () => {
  it('disables move up on the first segment and move down on the last', () => {
    renderList([makeSegment('a'), makeSegment('b'), makeSegment('c')]);

    const moveUpButtons = screen.getAllByRole('button', { name: '上移段落' });
    const moveDownButtons = screen.getAllByRole('button', { name: '下移段落' });
    expect(moveUpButtons).toHaveLength(3);
    expect(moveDownButtons).toHaveLength(3);

    // First segment: move up disabled, move down enabled
    expect(moveUpButtons[0]).toBeDisabled();
    expect(moveDownButtons[0]).toBeEnabled();
    // Middle: both enabled
    expect(moveUpButtons[1]).toBeEnabled();
    expect(moveDownButtons[1]).toBeEnabled();
    // Last: move up enabled, move down disabled
    expect(moveUpButtons[2]).toBeEnabled();
    expect(moveDownButtons[2]).toBeDisabled();
  });

  it('does not render move buttons when there is only one segment', () => {
    renderList([makeSegment('a')]);
    expect(screen.queryByRole('button', { name: '上移段落' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '下移段落' })).not.toBeInTheDocument();
  });

  it('translates move up/down into onReorder(from, to) index pairs', () => {
    const onReorder = vi.fn();
    renderList([makeSegment('a'), makeSegment('b'), makeSegment('c')], { onReorder });

    const moveUpButtons = screen.getAllByRole('button', { name: '上移段落' });
    const moveDownButtons = screen.getAllByRole('button', { name: '下移段落' });

    // Move the 2nd segment (index 1) up -> onReorder(1, 0)
    fireEvent.click(moveUpButtons[1]);
    expect(onReorder).toHaveBeenLastCalledWith(1, 0);

    // Move the 2nd segment (index 1) down -> onReorder(1, 2)
    fireEvent.click(moveDownButtons[1]);
    expect(onReorder).toHaveBeenLastCalledWith(1, 2);
  });
});
