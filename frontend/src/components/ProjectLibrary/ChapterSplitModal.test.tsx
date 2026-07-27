import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

vi.mock('../../i18n', () => ({
  useTranslation: () => ({ t: (k: string, p?: Record<string, unknown>) => (p ? `${k}:${JSON.stringify(p)}` : k), locale: 'zh-CN', setLocale: () => {} }),
}));

const markdownDetect = vi.fn();
const markdownSplit = vi.fn();
const batchCreateChapters = vi.fn();

vi.mock('../../services/api', () => ({
  textSplitApi: {
    markdownDetect: (...a: unknown[]) => markdownDetect(...a),
    markdownSplit: (...a: unknown[]) => markdownSplit(...a),
  },
  segmentedProjectApi: {
    batchCreateChapters: (...a: unknown[]) => batchCreateChapters(...a),
  },
}));

afterEach(() => cleanup());
beforeEach(() => {
  vi.clearAllMocks();
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
    expect(batchCreateChapters).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'chapterSplit.confirmLabel' }));
    await waitFor(() => expect(batchCreateChapters).toHaveBeenCalled());
    const [pid, chapters, narrationScript] = batchCreateChapters.mock.calls[0];
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
    await waitFor(() => expect(onApplied).toHaveBeenCalled());
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
    expect(batchCreateChapters).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('shows error when detect fails', async () => {
    markdownDetect.mockRejectedValue(new Error('boom'));
    render(<ChapterSplitModal {...baseProps} />);
    expect(await screen.findByText(/boom/)).toBeInTheDocument();
  });
});
