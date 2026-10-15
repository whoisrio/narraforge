import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Segment, SegmentVerification } from '../../types';
import { VerificationDetailModal } from './VerificationDetailModal';

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

const mismatch: SegmentVerification = {
  audio_key: 'aud-1',
  status: 'mismatch',
  baseline_text: '保温杯可以装热水',
  asr_text: '保温杯可以装热水呢',
  similarity: 0.93,
  match: false,
  diff: [
    { op: 'equal', baseline: '保温杯可以装热水', asr: '保温杯可以装热水' },
    { op: 'insert', baseline: '', asr: '呢' },
  ],
  engine: 'funasr',
  checked_at: '2026-10-15T00:00:00Z',
};

describe('VerificationDetailModal', () => {
  it('mismatch：并排 diff + 相似度 + 忽略/重新核对/重新 TTS 三操作', () => {
    const onIgnore = vi.fn();
    const onReverify = vi.fn();
    const onRegenerate = vi.fn();
    render(
      <VerificationDetailModal
        segment={makeSegment(mismatch)}
        onClose={vi.fn()}
        onIgnore={onIgnore}
        onReverify={onReverify}
        onRegenerate={onRegenerate}
      />,
    );
    // 并排：显示原文 / 基准 / 回读
    expect(screen.getByText('显示原文')).toBeInTheDocument();
    expect(screen.getByText('基准（实际朗读）')).toBeInTheDocument();
    expect(screen.getByText('ASR 回读')).toBeInTheDocument();
    // diff 高亮：insert 片段「呢」出现在回读侧
    expect(screen.getByText('呢')).toBeInTheDocument();
    expect(screen.getByText(/相似度 93%/)).toBeInTheDocument();
    // 三个操作
    fireEvent.click(screen.getByRole('button', { name: '忽略不一致' }));
    expect(onIgnore).toHaveBeenCalledWith('s1');
    fireEvent.click(screen.getByRole('button', { name: '重新核对' }));
    expect(onReverify).toHaveBeenCalledWith('s1');
    fireEvent.click(screen.getByRole('button', { name: '重新 TTS' }));
    expect(onRegenerate).toHaveBeenCalledWith('s1');
  });

  it('ignored：不再提供「忽略不一致」入口', () => {
    render(
      <VerificationDetailModal
        segment={makeSegment({ ...mismatch, status: 'ignored' })}
        onClose={vi.fn()}
        onIgnore={vi.fn()}
        onReverify={vi.fn()}
        onRegenerate={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: '忽略不一致' })).not.toBeInTheDocument();
  });

  it('error：展示错误信息，无忽略入口', () => {
    render(
      <VerificationDetailModal
        segment={makeSegment({ ...mismatch, status: 'error', error: 'verify timeout', asr_text: '' })}
        onClose={vi.fn()}
        onIgnore={vi.fn()}
        onReverify={vi.fn()}
        onRegenerate={vi.fn()}
      />,
    );
    expect(screen.getByText(/核对出错：verify timeout/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '忽略不一致' })).not.toBeInTheDocument();
  });

  it('回读为空：明示「回读为空」', () => {
    render(
      <VerificationDetailModal
        segment={makeSegment({ ...mismatch, asr_text: '', similarity: 0, match: false })}
        onClose={vi.fn()}
        onIgnore={vi.fn()}
        onReverify={vi.fn()}
        onRegenerate={vi.fn()}
      />,
    );
    expect(screen.getByText(/回读为空/)).toBeInTheDocument();
  });

  it('audio_key 不匹配（已过期）：提示旧结果不再作为判定依据', () => {
    render(
      <VerificationDetailModal
        segment={makeSegment({ ...mismatch, audio_key: 'old-key' })}
        onClose={vi.fn()}
        onIgnore={vi.fn()}
        onReverify={vi.fn()}
        onRegenerate={vi.fn()}
      />,
    );
    expect(screen.getAllByText(/已过期/).length).toBeGreaterThan(0);
    expect(screen.getByText(/旧结果不再作为判定依据/)).toBeInTheDocument();
  });

  it('关闭按钮触发 onClose', () => {
    const onClose = vi.fn();
    render(
      <VerificationDetailModal
        segment={makeSegment(mismatch)}
        onClose={onClose}
        onIgnore={vi.fn()}
        onReverify={vi.fn()}
        onRegenerate={vi.fn()}
      />,
    );
    // 头部 ×（第一个「关闭」按钮，footer 的关闭是 ghost 样式另一个）
    const closeButtons = screen.getAllByRole('button', { name: '关闭' });
    fireEvent.click(closeButtons[0]);
    expect(onClose).toHaveBeenCalled();
  });
});
