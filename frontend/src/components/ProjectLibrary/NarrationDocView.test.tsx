import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../../i18n', () => ({
  useTranslation: () => ({
    t: (k: string, p?: Record<string, unknown>) => (p ? `${k}:${JSON.stringify(p)}` : k),
    locale: 'zh-CN',
    setLocale: () => {},
  }),
}));

afterEach(() => cleanup());

import { NarrationDocView } from './NarrationDocView';

const baseProps = {
  narrationScript: null as string | null,
  joinedChapterText: '这是第一章的内容。',
  chapterCount: 1,
  onUpdateNarrationScript: vi.fn(),
  onSplit: vi.fn(),
  onGoToSource: vi.fn(),
};

describe('NarrationDocView', () => {
  it('form A (empty narration): shows empty-state entries + joined-chapter preview, no split button', () => {
    render(<NarrationDocView {...baseProps} />);
    expect(screen.getByText('projectLibrary.narrationDoc.emptyHint')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'projectLibrary.narrationDoc.paste' })).toBeInTheDocument();
    // B2：「去源文档」次按钮（切到 source 视图）
    expect(screen.getByRole('button', { name: 'projectLibrary.narrationDoc.goToSource' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'projectLibrary.narrationDoc.generateFromChapters' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'projectLibrary.splitChapters' })).not.toBeInTheDocument();
    expect(screen.getByText('这是第一章的内容。')).toBeInTheDocument();
  });

  it('form A: go-to-source button calls onGoToSource', () => {
    const onGoToSource = vi.fn();
    render(<NarrationDocView {...baseProps} onGoToSource={onGoToSource} />);
    fireEvent.click(screen.getByRole('button', { name: 'projectLibrary.narrationDoc.goToSource' }));
    expect(onGoToSource).toHaveBeenCalled();
  });

  it('form A: generate-from-chapters fills narration_script with joined chapter text', () => {
    const onUpdateNarrationScript = vi.fn();
    render(<NarrationDocView {...baseProps} onUpdateNarrationScript={onUpdateNarrationScript} />);
    fireEvent.click(screen.getByRole('button', { name: 'projectLibrary.narrationDoc.generateFromChapters' }));
    expect(onUpdateNarrationScript).toHaveBeenCalledWith('这是第一章的内容。');
  });

  it('form A: paste entry switches to an empty editor', () => {
    render(<NarrationDocView {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: 'projectLibrary.narrationDoc.paste' }));
    expect(screen.getByRole('textbox')).toHaveValue('');
  });

  it('form A: generate-from-chapters hidden when no chapter text', () => {
    render(<NarrationDocView {...baseProps} joinedChapterText="" chapterCount={0} />);
    expect(screen.queryByRole('button', { name: 'projectLibrary.narrationDoc.generateFromChapters' })).not.toBeInTheDocument();
    // 粘贴 CTA 与去源文档始终可用
    expect(screen.getByRole('button', { name: 'projectLibrary.narrationDoc.paste' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'projectLibrary.narrationDoc.goToSource' })).toBeInTheDocument();
  });

  it('form B (narration set): shows split button + markdown preview, no empty-state banner', () => {
    render(<NarrationDocView {...baseProps} narrationScript={'# 标题\n\n正文内容'} />);
    expect(screen.getByRole('button', { name: 'projectLibrary.splitChapters' })).toBeInTheDocument();
    expect(screen.getByText('正文内容')).toBeInTheDocument();
    expect(screen.queryByText('projectLibrary.narrationDoc.emptyHint')).not.toBeInTheDocument();
  });

  it('form B: edit toggle reveals textarea bound to narration_script', () => {
    const onUpdateNarrationScript = vi.fn();
    render(<NarrationDocView {...baseProps} narrationScript="原始旁白" onUpdateNarrationScript={onUpdateNarrationScript} />);
    fireEvent.click(screen.getByRole('button', { name: 'common.edit' }));
    expect(screen.getByRole('textbox')).toHaveValue('原始旁白');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '改后的旁白' } });
    expect(onUpdateNarrationScript).toHaveBeenCalledWith('改后的旁白');
  });

  it('form B: split button calls onSplit', () => {
    const onSplit = vi.fn();
    render(<NarrationDocView {...baseProps} narrationScript="有旁白" onSplit={onSplit} />);
    fireEvent.click(screen.getByRole('button', { name: 'projectLibrary.splitChapters' }));
    expect(onSplit).toHaveBeenCalled();
  });

  it('bottom bar is removed (B2: header switcher covers navigation)', () => {
    render(<NarrationDocView {...baseProps} />);
    expect(screen.queryByText(/projectLibrary.backToLibrary/)).not.toBeInTheDocument();
    expect(screen.queryByText('projectLibrary.viewByChapter')).not.toBeInTheDocument();
  });
});
