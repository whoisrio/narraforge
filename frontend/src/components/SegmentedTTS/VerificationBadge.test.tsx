import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Segment, SegmentVerification } from '../../types';
import { VerificationBadge } from './VerificationBadge';

function makeSegment(verification?: SegmentVerification): Segment {
  return {
    id: 's1',
    text: '保温杯可以装热水。',
    voice: { source: 'chapter' },
    status: 'ready',
    audio: { format: 'mp3', current: { id: 'aud-1' } },
    segment_kind: 'narration',
    verification,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };
}

const v = (overrides: Partial<SegmentVerification>): SegmentVerification => ({
  audio_key: 'aud-1', status: 'match', baseline_text: 'a', asr_text: 'a',
  engine: 'funasr', checked_at: '2026-01-01T00:00:00Z', ...overrides,
});

describe('VerificationBadge', () => {
  it('未核对：显示「未核对」', () => {
    render(<VerificationBadge segment={makeSegment()} />);
    expect(screen.getByText(/未核对/)).toBeInTheDocument();
  });

  it('一致：✓ + 相似度 tooltip', () => {
    render(<VerificationBadge segment={makeSegment(v({ status: 'match', similarity: 0.98 }))} />);
    expect(screen.getByText(/一致/)).toBeInTheDocument();
    expect(screen.getByRole('button')).toHaveAttribute('title', expect.stringContaining('98%'));
  });

  it('不一致：✗ 不一致', () => {
    render(<VerificationBadge segment={makeSegment(v({ status: 'mismatch', similarity: 0.42, match: false }))} />);
    expect(screen.getByText(/不一致/)).toBeInTheDocument();
  });

  it('已忽略 / 出错', () => {
    render(<VerificationBadge segment={makeSegment(v({ status: 'ignored' }))} />);
    expect(screen.getByText(/已忽略/)).toBeInTheDocument();
    const { unmount } = render(<VerificationBadge segment={makeSegment(v({ status: 'error', error: 'verify timeout' }))} />);
    expect(screen.getByText(/出错/)).toBeInTheDocument();
    unmount();
  });

  it('audio_key 不匹配 → 已过期（按未核对处理）', () => {
    render(<VerificationBadge segment={makeSegment(v({ audio_key: 'old-key' }))} />);
    expect(screen.getByText(/已过期/)).toBeInTheDocument();
  });

  it('verifying（in-flight 内存态）优先于持久化状态', () => {
    render(<VerificationBadge segment={makeSegment(v({ status: 'match' }))} verifying />);
    expect(screen.getByText(/核对中/)).toBeInTheDocument();
  });

  it('点击打开核对详情', () => {
    const onOpenDetail = vi.fn();
    render(<VerificationBadge segment={makeSegment(v({ status: 'mismatch' }))} onOpenDetail={onOpenDetail} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onOpenDetail).toHaveBeenCalledWith('s1');
  });

  // ── 双职责角标：未核对/已过期 → 点击直接发起核对；已有结果 → 点击看详情 ──
  it('未核对 + onVerify：点击发起核对，不开详情', () => {
    const onOpenDetail = vi.fn();
    const onVerify = vi.fn();
    render(<VerificationBadge segment={makeSegment()} onOpenDetail={onOpenDetail} onVerify={onVerify} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onVerify).toHaveBeenCalledWith('s1');
    expect(onOpenDetail).not.toHaveBeenCalled();
  });

  it('未核对 + onVerify：tooltip 提示可直接核对', () => {
    render(<VerificationBadge segment={makeSegment()} onVerify={vi.fn()} />);
    expect(screen.getByRole('button')).toHaveAttribute('title', expect.stringContaining('点击核对'));
  });

  it('已过期 + onVerify：点击重新核对', () => {
    const onOpenDetail = vi.fn();
    const onVerify = vi.fn();
    render(<VerificationBadge segment={makeSegment(v({ audio_key: 'old-key' }))} onOpenDetail={onOpenDetail} onVerify={onVerify} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onVerify).toHaveBeenCalledWith('s1');
    expect(onOpenDetail).not.toHaveBeenCalled();
  });

  it('已有结果（不一致）：点击仍开详情，不触发核对', () => {
    const onOpenDetail = vi.fn();
    const onVerify = vi.fn();
    render(<VerificationBadge segment={makeSegment(v({ status: 'mismatch', match: false }))} onOpenDetail={onOpenDetail} onVerify={onVerify} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onOpenDetail).toHaveBeenCalledWith('s1');
    expect(onVerify).not.toHaveBeenCalled();
  });

  it('核对中：点击不重复触发', () => {
    const onVerify = vi.fn();
    const onOpenDetail = vi.fn();
    render(<VerificationBadge segment={makeSegment()} verifying onVerify={onVerify} onOpenDetail={onOpenDetail} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onVerify).not.toHaveBeenCalled();
    expect(onOpenDetail).not.toHaveBeenCalled();
  });

  it('未传 onVerify 时保持向后兼容：未核对点击开详情', () => {
    const onOpenDetail = vi.fn();
    render(<VerificationBadge segment={makeSegment()} onOpenDetail={onOpenDetail} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onOpenDetail).toHaveBeenCalledWith('s1');
  });
});
