import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { Segment } from '../../types';
import { SegmentEditPanel } from './SegmentEditPanel';

vi.mock('../../services/api', () => ({
  ttsApi: { getEdgeVoices: vi.fn().mockResolvedValue([]) },
  mimoTtsApi: { getPresetVoices: vi.fn().mockResolvedValue([]) },
}));

function makeSegment(transforms?: Segment['text_transforms']): Segment {
  return {
    id: 's1', text: '调用 REST API 接口。', voice: { source: 'chapter' }, status: 'idle',
    audio: { format: 'mp3' }, segment_kind: 'narration',
    text_transforms: transforms, created_at: 'x', updated_at: 'x',
  };
}

function renderPanel(segment: Segment, onUpdateTextTransforms = vi.fn()) {
  render(
    <SegmentEditPanel
      segment={segment}
      voices={[]}
      roles={[]}
      chapterEngine="edge_tts"
      onClose={() => {}}
      onUpdateText={() => {}}
      onUpdateSSML={() => {}}
      onUpdateEmotion={() => {}}
      onUndo={() => {}}
      onRegenerate={() => {}}
      onConfirmCustom={() => {}}
      onAnnotateSSML={() => {}}
      onSplit={() => {}}
      onUpdateTextTransforms={onUpdateTextTransforms}
    />,
  );
  return { onUpdateTextTransforms };
}

describe('SegmentEditPanel 大写词转小写三态', () => {
  it('默认「跟随项目」为激活态', () => {
    renderPanel(makeSegment());
    expect(screen.getByRole('button', { name: '跟随项目' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('点击「开」写回 lowercase_latin: true（保留已有 applied_map_ids）', () => {
    const { onUpdateTextTransforms } = renderPanel(makeSegment({ applied_map_ids: ['pm_a'] }));
    fireEvent.click(screen.getByRole('button', { name: '开' }));
    expect(onUpdateTextTransforms).toHaveBeenCalledWith('s1', { applied_map_ids: ['pm_a'], lowercase_latin: true });
  });

  it('已设为 false 时「关」为激活态', () => {
    renderPanel(makeSegment({ lowercase_latin: false }));
    expect(screen.getByRole('button', { name: '关' }).getAttribute('aria-pressed')).toBe('true');
  });
});
