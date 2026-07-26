import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
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

const DETECT = {
  doc_title: '文档标题',
  candidates: [
    { index: 0, title: '第一章', level: 2, start_char: 8, end_char: 16, char_count: 4, preview: '内容一。' },
    { index: 1, title: '第二章', level: 2, start_char: 20, end_char: 28, char_count: 4, preview: '内容二。' },
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
    expect(await screen.findByText('第一章')).toBeInTheDocument();
    expect(screen.getByText('第二章')).toBeInTheDocument();
  });

  it('apply replaces chapters via chapters:batch with sliced texts', async () => {
    markdownDetect.mockResolvedValue(DETECT);
    markdownSplit.mockResolvedValue(SPLIT);
    batchCreateChapters.mockResolvedValue({ chapters: [] });
    const onApplied = vi.fn();
    render(<ChapterSplitModal {...baseProps} onApplied={onApplied} />);
    fireEvent.click(await screen.findByText('chapterSplit.preview'));
    await screen.findByText('第一章');
    // replace warning mentions existing count
    expect(screen.getByText(/chapterSplit.replaceWarning/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('chapterSplit.apply'));
    await waitFor(() => expect(batchCreateChapters).toHaveBeenCalled());
    const [pid, chapters, narrationScript] = batchCreateChapters.mock.calls[0];
    expect(pid).toBe('p1');
    expect(chapters).toHaveLength(2);
    expect(chapters[0].chapter_title).toBe('第一章');
    expect(chapters[0].narration_script).toBe(FULL_TEXT.slice(8, 16));
    expect(chapters[1].narration_script).toBe(FULL_TEXT.slice(20, 28));
    expect(narrationScript).toBe(FULL_TEXT);
    await waitFor(() => expect(onApplied).toHaveBeenCalled());
  });

  it('shows error when detect fails', async () => {
    markdownDetect.mockRejectedValue(new Error('boom'));
    render(<ChapterSplitModal {...baseProps} />);
    expect(await screen.findByText(/boom/)).toBeInTheDocument();
  });
});
