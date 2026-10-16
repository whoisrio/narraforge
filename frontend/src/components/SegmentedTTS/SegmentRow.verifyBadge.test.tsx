/**
 * SegmentRow 语音核对角标双职责：
 * 紧凑模式（默认视图）下未核对 → 点角标直接核对；已有结果 → 点角标开详情。
 * 对应修复：紧凑行原先没有任何核对触发入口。
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Segment, SegmentVerification } from '../../types';
import { SegmentRow } from './SegmentRow';

const baseSegment: Segment = {
  id: 's1',
  text: '保温杯可以装热水。',
  voice: { source: 'chapter' },
  audio: { format: 'mp3', current: { id: 'aud-1' } },
  status: 'ready',
  segment_kind: 'narration',
  created_at: '2026-01-01',
  updated_at: '2026-01-01',
};

const v = (overrides: Partial<SegmentVerification>): SegmentVerification => ({
  audio_key: 'aud-1', status: 'mismatch', baseline_text: 'a', asr_text: 'b',
  similarity: 0.4, match: false, engine: 'funasr', checked_at: '2026-01-01T00:00:00Z', ...overrides,
});

function renderRow(segment: Segment, compact: boolean, handlers: { onVerifySegment?: (id: string) => void; onOpenVerifyDetail?: (id: string) => void }) {
  render(
    <SegmentRow
      segment={segment}
      index={1}
      isSelected={false}
      isPlaying={false}
      isPaused={false}
      compact={compact}
      voices={[]}
      roles={[]}
      globalEdgeVoice="zh-CN-YunxiNeural"
      engine="edge_tts"
      layout="vertical"
      onSelect={vi.fn()}
      onDelete={vi.fn()}
      onEdit={vi.fn()}
      onRegenerate={vi.fn()}
      onPlay={vi.fn()}
      onUndo={vi.fn()}
      onVerifySegment={handlers.onVerifySegment}
      onOpenVerifyDetail={handlers.onOpenVerifyDetail}
      isLast
    />,
  );
}

describe('SegmentRow verify badge trigger', () => {
  it('紧凑模式：未核对段点角标 → 直接发起核对', () => {
    const onVerifySegment = vi.fn();
    const onOpenVerifyDetail = vi.fn();
    renderRow(baseSegment, true, { onVerifySegment, onOpenVerifyDetail });

    const badge = screen.getByRole('button', { name: /语音核对/ });
    expect(badge).toHaveAttribute('title', expect.stringContaining('点击核对'));
    fireEvent.click(badge);
    expect(onVerifySegment).toHaveBeenCalledWith('s1');
    expect(onOpenVerifyDetail).not.toHaveBeenCalled();
  });

  it('紧凑模式：已有不一致结果点角标 → 打开详情', () => {
    const onVerifySegment = vi.fn();
    const onOpenVerifyDetail = vi.fn();
    renderRow({ ...baseSegment, verification: v({}) }, true, { onVerifySegment, onOpenVerifyDetail });

    fireEvent.click(screen.getByRole('button', { name: /语音核对：不一致/ }));
    expect(onOpenVerifyDetail).toHaveBeenCalledWith('s1');
    expect(onVerifySegment).not.toHaveBeenCalled();
  });

  it('展开模式：不一致角标点击 → 打开详情', () => {
    const onOpenVerifyDetail = vi.fn();
    renderRow({ ...baseSegment, verification: v({}) }, false, { onOpenVerifyDetail });

    fireEvent.click(screen.getByRole('button', { name: /不一致/ }));
    expect(onOpenVerifyDetail).toHaveBeenCalledWith('s1');
  });

  it('展开模式：未核对角标点击 → 发起核对', () => {
    const onVerifySegment = vi.fn();
    renderRow(baseSegment, false, { onVerifySegment });

    fireEvent.click(screen.getByRole('button', { name: /未核对/ }));
    expect(onVerifySegment).toHaveBeenCalledWith('s1');
  });
});
