import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { SegmentVerification } from '../../types';
import type { VerifyReportData, VerifyReportItem } from '../../services/ttsVerify';
import { VerifyReportModal } from './VerifyReportModal';

const v = (overrides: Partial<SegmentVerification>): SegmentVerification => ({
  audio_key: 'aud-1', status: 'mismatch', baseline_text: '保温杯可以装热水', asr_text: '保温杯可以装被子',
  similarity: 0.6, match: false, engine: 'funasr', checked_at: '2026-01-01T00:00:00Z', ...overrides,
});

function item(overrides: Partial<VerifyReportItem> = {}): VerifyReportItem {
  return {
    segmentId: 's1', chapterId: 'ch1', chapterName: '第一章', segmentIndex: 1,
    displayText: '保温杯可以装热水。', verification: v(), ...overrides,
  };
}

const data = (overrides: Partial<VerifyReportData> = {}): VerifyReportData => ({
  scope: 'project', total: 4, verified: 4,
  matchCount: 2, mismatchCount: 1, errorCount: 1,
  items: [item(), item({
    segmentId: 's2', segmentIndex: 2, displayText: '出错段文本',
    verification: v({ status: 'error', error: 'verify timeout', asr_text: '', similarity: undefined, diff: undefined }),
  })],
  ...overrides,
});

function renderModal(overrides: Partial<React.ComponentProps<typeof VerifyReportModal>> = {}) {
  const onClose = vi.fn();
  const onOpenDetail = vi.fn();
  const onIgnore = vi.fn();
  render(<VerifyReportModal data={data()} onClose={onClose} onOpenDetail={onOpenDetail} onIgnore={onIgnore} {...overrides} />);
  return { onClose, onOpenDetail, onIgnore };
}

describe('VerifyReportModal', () => {
  it('标题 + 汇总计数（一致/不一致/出错）', () => {
    renderModal();
    expect(screen.getByText('语音核对报告')).toBeInTheDocument();
    expect(screen.getByText('一致 2')).toBeInTheDocument();
    expect(screen.getByText('不一致 1')).toBeInTheDocument();
    expect(screen.getByText('出错 1')).toBeInTheDocument();
  });

  it('每条 mismatch 展示 显示原文 / 基准 / ASR 回读 + 章节序号 + 相似度', () => {
    renderModal();
    expect(screen.getByText('第一章 · #1')).toBeInTheDocument();
    expect(screen.getByText('保温杯可以装热水。')).toBeInTheDocument();
    expect(screen.getAllByText('基准（实际朗读）').length).toBeGreaterThan(0);
    expect(screen.getAllByText('ASR 回读').length).toBeGreaterThan(0);
    expect(screen.getByText('保温杯可以装被子')).toBeInTheDocument();
    expect(screen.getByText(/相似度 60%/)).toBeInTheDocument();
  });

  it('error 条目显示错误信息而不是 diff', () => {
    renderModal();
    expect(screen.getByText(/核对出错：verify timeout/)).toBeInTheDocument();
  });

  it('「详情」→ onOpenDetail；mismatch 条目「忽略」→ onIgnore（error 条目无忽略）', () => {
    const { onOpenDetail, onIgnore } = renderModal();
    fireEvent.click(screen.getAllByRole('button', { name: '详情' })[0]);
    expect(onOpenDetail).toHaveBeenCalledWith('s1');
    fireEvent.click(screen.getByRole('button', { name: '忽略' }));
    expect(onIgnore).toHaveBeenCalledWith('s1');
    // error 条目（s2）没有忽略按钮：忽略按钮总共只出现一次
    expect(screen.getAllByRole('button', { name: '忽略' })).toHaveLength(1);
  });

  it('关闭按钮 / 遮罩点击 → onClose', () => {
    const { onClose } = renderModal();
    fireEvent.click(screen.getByText('关闭')); // footer 主按钮（头部 × 的 aria-label 同名，用文本匹配区分）
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('dialog', { name: '语音核对报告' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('items 为空（全部一致）→ 空态提示', () => {
    renderModal({ data: data({ items: [], mismatchCount: 0, errorCount: 0 }) });
    expect(screen.getByText('全部一致，无需处理。')).toBeInTheDocument();
  });
});
