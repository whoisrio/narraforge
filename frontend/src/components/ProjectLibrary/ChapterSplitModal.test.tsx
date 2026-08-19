import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

vi.mock('../../i18n', () => ({
  useTranslation: () => ({ t: (k: string, p?: Record<string, unknown>) => (p ? `${k}:${JSON.stringify(p)}` : k), locale: 'zh-CN', setLocale: () => {} }),
}));

const markdownDetect = vi.fn();
const markdownSplit = vi.fn();
const batchCreateChapters = vi.fn();
const toastSuccess = vi.fn();

vi.mock('../../services/api', () => ({
  textSplitApi: {
    markdownDetect: (...a: unknown[]) => markdownDetect(...a),
    markdownSplit: (...a: unknown[]) => markdownSplit(...a),
  },
  segmentedProjectApi: {
    batchCreateChapters: (...a: unknown[]) => batchCreateChapters(...a),
  },
}));

vi.mock('../ui/useToast', () => ({
  useToast: () => ({ success: toastSuccess, error: vi.fn(), info: vi.fn() }),
}));

afterEach(() => cleanup());
beforeEach(() => {
  vi.clearAllMocks();
  // 默认 dry_run/apply 均成功且不带 reuse 报告；各用例按需覆盖
  batchCreateChapters.mockResolvedValue({ chapters: [] });
});

import { ChapterSplitModal } from '../ProjectLibrary/ChapterSplitModal';

const FULL_TEXT = '# 文档标题\n\n## 第一章\n内容一。\n\n## 第二章\n内容二。\n';

// 真实对齐 FULL_TEXT 的标题位置（## 第一章 @8, ## 第二章 @21, 末尾 @33）
const DETECT = {
  doc_title: '文档标题',
  candidates: [
    { index: 0, title: '第一章', level: 2, start_char: 8, end_char: 21, char_count: 13, preview: '内容一。' },
    { index: 1, title: '第二章', level: 2, start_char: 21, end_char: 33, char_count: 12, preview: '内容二。' },
  ],
  chapters: [],
  total_chars: FULL_TEXT.length,
};

const SPLIT = {
  doc_title: '文档标题',
  chapters: DETECT.candidates,
  total_chars: FULL_TEXT.length,
  used_levels: [2],
};

const baseProps = {
  projectId: 'p1',
  fullText: FULL_TEXT,
  existingChapterCount: 3,
  onClose: vi.fn(),
  onApplied: vi.fn(),
};

describe('ChapterSplitModal', () => {
  it('detects headings on mount and shows level candidates', async () => {
    markdownDetect.mockResolvedValue(DETECT);
    render(<ChapterSplitModal {...baseProps} />);
    await waitFor(() => expect(markdownDetect).toHaveBeenCalledWith(FULL_TEXT));
    expect(await screen.findByText('文档标题')).toBeInTheDocument();
    expect(screen.getByText('H2 (2)')).toBeInTheDocument();
  });

  it('previews chapters via markdown-split with chosen levels', async () => {
    markdownDetect.mockResolvedValue(DETECT);
    markdownSplit.mockResolvedValue(SPLIT);
    render(<ChapterSplitModal {...baseProps} />);
    fireEvent.click(await screen.findByText('chapterSplit.preview'));
    await waitFor(() => expect(markdownSplit).toHaveBeenCalledWith(FULL_TEXT, [2]));
    expect(await screen.findByText('01. 第一章')).toBeInTheDocument();
    expect(screen.getByText('02. 第二章')).toBeInTheDocument();
  });

  /** 从调用记录里挑出真正的 apply 调用（重拆时预览阶段会先发 dry_run） */
  const applyCall = () => batchCreateChapters.mock.calls.find((c) => !c[3]?.dryRun);

  it('apply with existing chapters asks for confirm, then replaces with body text (heading stripped) + original_text', async () => {
    markdownDetect.mockResolvedValue(DETECT);
    markdownSplit.mockResolvedValue(SPLIT);
    batchCreateChapters.mockResolvedValue({ chapters: [] });
    const onApplied = vi.fn();
    render(<ChapterSplitModal {...baseProps} onApplied={onApplied} />);
    fireEvent.click(await screen.findByText('chapterSplit.preview'));
    await screen.findByText('01. 第一章');

    // 已有章节 -> 点应用先弹确认
    fireEvent.click(screen.getByText('chapterSplit.apply'));
    expect(screen.getByText('chapterSplit.confirmTitle')).toBeInTheDocument();
    expect(applyCall()).toBeUndefined();

    fireEvent.click(screen.getByRole('button', { name: 'chapterSplit.confirmLabel' }));
    await waitFor(() => expect(applyCall()).toBeTruthy());
    const [pid, chapters, narrationScript] = applyCall()!;
    expect(pid).toBe('p1');
    expect(chapters).toHaveLength(2);
    // 标题行被剥离，正文 + original_text 都落到章节上（章节卡片有内容、studio 可拆）
    expect(chapters[0].chapter_title).toBe('01. 第一章');
    expect(chapters[0].narration_script).toBe('内容一。');
    expect(chapters[0].original_text).toBe('内容一。');
    expect(chapters[1].chapter_title).toBe('02. 第二章');
    expect(chapters[1].narration_script).toBe('内容二。');
    expect(chapters[1].original_text).toBe('内容二。');
    // 项目级 narration_script 仍是完整文档
    expect(narrationScript).toBe(FULL_TEXT);
    // A3：重拆恒发 splitSegments=true（保留音频语义上蕴含重建 segment）
    expect(applyCall()![3]).toEqual({ preserveAudio: true, splitSegments: true });
    await waitFor(() => expect(onApplied).toHaveBeenCalled());
  });

  it('resplit hides the splitSegments checkbox and always sends splitSegments: true', async () => {
    markdownDetect.mockResolvedValue(DETECT);
    markdownSplit.mockResolvedValue(SPLIT);
    batchCreateChapters.mockResolvedValue({
      chapters: [],
      reuse: { chapters_matched: 1, segments_matched: 2, segments_reused: 2, segments_new: 3, per_chapter: [] },
    });
    render(<ChapterSplitModal {...baseProps} />);
    fireEvent.click(await screen.findByText('chapterSplit.preview'));
    await screen.findByText('01. 第一章');

    // A3：重拆不提供「空章节 + 全删」组合
    expect(screen.queryByText('chapterSplit.splitSegments')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('chapterSplit.apply'));
    fireEvent.click(await screen.findByRole('button', { name: 'chapterSplit.confirmLabel' }));

    await waitFor(() => expect(applyCall()).toBeTruthy());
    expect(applyCall()![3]).toEqual({ preserveAudio: true, splitSegments: true });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith(
      'chapterSplit.reuseReport:{"reused":2,"fresh":3}',
    ));
  });

  it('first split keeps the checkbox, checked by default (A3)', async () => {
    markdownDetect.mockResolvedValue(DETECT);
    markdownSplit.mockResolvedValue(SPLIT);
    batchCreateChapters.mockResolvedValue({ chapters: [] });
    render(<ChapterSplitModal {...baseProps} existingChapterCount={0} />);
    fireEvent.click(await screen.findByText('chapterSplit.preview'));
    await screen.findByText('01. 第一章');

    const checkbox = screen.getByText('chapterSplit.splitSegments');
    expect(checkbox).toBeInTheDocument();

    fireEvent.click(screen.getByText('chapterSplit.apply'));
    await waitFor(() => expect(batchCreateChapters).toHaveBeenCalled());
    // 首拆默认勾选：拆完即可进 Studio 合成
    expect(batchCreateChapters.mock.calls[0][3]).toEqual({ preserveAudio: false, splitSegments: true });
  });

  it('first split allows unchecking splitSegments for bare chapters', async () => {
    markdownDetect.mockResolvedValue(DETECT);
    markdownSplit.mockResolvedValue(SPLIT);
    batchCreateChapters.mockResolvedValue({ chapters: [] });
    render(<ChapterSplitModal {...baseProps} existingChapterCount={0} />);
    fireEvent.click(await screen.findByText('chapterSplit.preview'));
    await screen.findByText('01. 第一章');

    fireEvent.click(screen.getByText('chapterSplit.splitSegments'));
    fireEvent.click(screen.getByText('chapterSplit.apply'));
    await waitFor(() => expect(batchCreateChapters).toHaveBeenCalled());
    expect(batchCreateChapters.mock.calls[0][3]).toEqual({ preserveAudio: false, splitSegments: false });
  });

  it('resplit fires dry_run after preview and shows honest keep/discard details in confirm (A4)', async () => {
    markdownDetect.mockResolvedValue(DETECT);
    markdownSplit.mockResolvedValue(SPLIT);
    const report = {
      chapters_matched: 2, segments_matched: 5, segments_reused: 5, segments_new: 3,
      per_chapter: [],
      discard: { text_changed: 2, boundary_changed: 1, no_audio: 0 },
      recorded_discard: 1,
    };
    batchCreateChapters.mockImplementation((_pid: string, _ch: unknown, _n: unknown, opts?: { dryRun?: boolean }) =>
      Promise.resolve(opts?.dryRun ? { chapters: [], reuse: report } : { chapters: [], reuse: report }),
    );
    render(<ChapterSplitModal {...baseProps} />);
    fireEvent.click(await screen.findByText('chapterSplit.preview'));
    await screen.findByText('01. 第一章');

    // 预览后后台 dry_run
    await waitFor(() => expect(
      batchCreateChapters.mock.calls.some((c) => c[3]?.dryRun === true),
    ).toBe(true));
    const dryCall = batchCreateChapters.mock.calls.find((c) => c[3]?.dryRun)!;
    expect(dryCall[3]).toEqual({ preserveAudio: true, splitSegments: true, dryRun: true });

    fireEvent.click(screen.getByText('chapterSplit.apply'));
    const confirm = await screen.findByRole('alertdialog', { name: 'chapterSplit.confirmTitle' });
    // 诚实明细：保留 / 丢弃分类 / 录音高亮警示
    expect(within(confirm).getByText(/chapterSplit.confirmChapters/)).toBeInTheDocument();
    expect(within(confirm).getByText(/chapterSplit.confirmKept:\{"count":5\}/)).toBeInTheDocument();
    expect(within(confirm).getByText(/chapterSplit.confirmDiscard/)).toBeInTheDocument();
    expect(within(confirm).getByText(/chapterSplit.confirmRecorded:\{"count":1\}/)).toBeInTheDocument();
  });

  it('falls back to the plain confirm message when dry_run fails (A4)', async () => {
    markdownDetect.mockResolvedValue(DETECT);
    markdownSplit.mockResolvedValue(SPLIT);
    batchCreateChapters.mockImplementation((_pid: string, _ch: unknown, _n: unknown, opts?: { dryRun?: boolean }) =>
      opts?.dryRun ? Promise.reject(new Error('net down')) : Promise.resolve({ chapters: [] }),
    );
    render(<ChapterSplitModal {...baseProps} />);
    fireEvent.click(await screen.findByText('chapterSplit.preview'));
    await screen.findByText('01. 第一章');
    await waitFor(() => expect(
      batchCreateChapters.mock.calls.some((c) => c[3]?.dryRun === true),
    ).toBe(true));

    fireEvent.click(screen.getByText('chapterSplit.apply'));
    const confirm = await screen.findByRole('alertdialog', { name: 'chapterSplit.confirmTitle' });
    // dry_run 不可用不阻塞拆分：退回现文案
    expect(within(confirm).getByText(/chapterSplit.confirmMessage/)).toBeInTheDocument();
    expect(within(confirm).queryByText(/chapterSplit.confirmKept/)).not.toBeInTheDocument();
  });

  it('apply toast extends reuse report with discard details and recorded warning (A4)', async () => {
    markdownDetect.mockResolvedValue(DETECT);
    markdownSplit.mockResolvedValue(SPLIT);
    const report = {
      chapters_matched: 2, segments_matched: 5, segments_reused: 5, segments_new: 3,
      per_chapter: [],
      discard: { text_changed: 2, boundary_changed: 1, no_audio: 0 },
      recorded_discard: 2,
    };
    batchCreateChapters.mockResolvedValue({ chapters: [], reuse: report });
    render(<ChapterSplitModal {...baseProps} />);
    fireEvent.click(await screen.findByText('chapterSplit.preview'));
    await screen.findByText('01. 第一章');

    fireEvent.click(screen.getByText('chapterSplit.apply'));
    fireEvent.click(await screen.findByRole('button', { name: 'chapterSplit.confirmLabel' }));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    const msg = toastSuccess.mock.calls[0][0] as string;
    expect(msg).toContain('chapterSplit.reuseReport:{"reused":5,"fresh":3}');
    expect(msg).toContain('chapterSplit.reuseReportDiscard');
    expect(msg).toContain('chapterSplit.reuseReportRecorded:{"count":2}');
  });

  it('shows divergence warning only when narration doc diverges from chapters (A6)', async () => {
    markdownDetect.mockResolvedValue(DETECT);
    render(<ChapterSplitModal {...baseProps} divergenceWarning />);
    expect(await screen.findByText('chapterSplit.divergenceWarning')).toBeInTheDocument();

    cleanup();
    render(<ChapterSplitModal {...baseProps} />);
    await screen.findByText('文档标题');
    expect(screen.queryByText('chapterSplit.divergenceWarning')).not.toBeInTheDocument();
  });

  it('apply with no existing chapters replaces directly without confirm', async () => {
    markdownDetect.mockResolvedValue(DETECT);
    markdownSplit.mockResolvedValue(SPLIT);
    batchCreateChapters.mockResolvedValue({ chapters: [] });
    render(<ChapterSplitModal {...baseProps} existingChapterCount={0} />);
    fireEvent.click(await screen.findByText('chapterSplit.preview'));
    await screen.findByText('01. 第一章');

    fireEvent.click(screen.getByText('chapterSplit.apply'));
    // 无已有章节 -> 不弹确认，直接应用
    expect(screen.queryByText('chapterSplit.confirmTitle')).not.toBeInTheDocument();
    await waitFor(() => expect(batchCreateChapters).toHaveBeenCalled());
  });

  it('confirm cancel does not apply', async () => {
    markdownDetect.mockResolvedValue(DETECT);
    markdownSplit.mockResolvedValue(SPLIT);
    render(<ChapterSplitModal {...baseProps} />);
    fireEvent.click(await screen.findByText('chapterSplit.preview'));
    await screen.findByText('01. 第一章');

    fireEvent.click(screen.getByText('chapterSplit.apply'));
    const confirm = screen.getByRole('alertdialog', { name: 'chapterSplit.confirmTitle' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'common.cancel' }));
    // dry_run（预览阶段后台调用）不算 apply
    expect(applyCall()).toBeUndefined();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('shows error when detect fails', async () => {
    markdownDetect.mockRejectedValue(new Error('boom'));
    render(<ChapterSplitModal {...baseProps} />);
    expect(await screen.findByText(/boom/)).toBeInTheDocument();
  });
});
