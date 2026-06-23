import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Chapter } from '../../types';
import { ProjectLibrary } from './ProjectLibrary';

const baseParams = {
  engine: 'edge_tts' as const,
  edge_voice: 'zh-CN-YunxiNeural',
  edge_rate: '+0%',
  edge_volume: '+0%',
  language: 'Chinese',
  speed: 1,
  volume: 80,
  pitch: 1,
};

function makeChapter(id: string, name: string, originalText: string, segments = 0): Chapter {
  return {
    id,
    name,
    original_text: originalText,
    design_title: `${name} 视觉标题`,
    segments: Array.from({ length: segments }, (_, index) => ({
      id: `${id}-s-${index}`,
      text: `segment ${index}`,
      params: baseParams,
      status: index % 2 === 0 ? 'ready' : 'idle',
      duration_sec: index % 2 === 0 ? 6 : undefined,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    })),
    default_params: baseParams,
    split_config: { delimiters: ['。'], mode: 'rule' },
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}

describe('ProjectLibrary', () => {
  it('renders a design-style chapter card overview by default', () => {
    render(
      <ProjectLibrary
        chapters={[
          makeChapter('ch-1', '第一章', '这是第一章完整旁白文本。', 3),
          makeChapter('ch-2', '第二章', '这是第二章完整旁白文本。', 1),
        ]}
        activeChapterId="ch-1"
        onSelectChapter={vi.fn()}
        onRenameChapter={vi.fn()}
        onUpdateChapterText={vi.fn()}
        onAddChapter={vi.fn()}
        onEnterStudio={vi.fn()}
      />,
    );

    expect(screen.getByText('Chapter Library')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /新建章节/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /选择第一章/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /选择第二章/ })).toBeInTheDocument();
    expect(screen.getAllByText('12 字').length).toBeGreaterThan(0);
    expect(screen.getByText('3 段')).toBeInTheDocument();
    expect(screen.getByText('2/3 已生成')).toBeInTheDocument();
    expect(screen.getAllByText('打开文本').length).toBeGreaterThan(0);
    expect(screen.getAllByText('进入工作室').length).toBeGreaterThan(0);
  });

  it('opens an immersive chapter text view from a chapter card', () => {
    render(
      <ProjectLibrary
        chapters={[makeChapter('ch-1', '第一章', '这是第一章完整旁白文本。', 3)]}
        activeChapterId="ch-1"
        onSelectChapter={vi.fn()}
        onRenameChapter={vi.fn()}
        onUpdateChapterText={vi.fn()}
        onAddChapter={vi.fn()}
        onEnterStudio={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /打开文本/ }));

    expect(screen.getByText('Immersive Chapter Editor')).toBeInTheDocument();
    expect(screen.getByLabelText('章节标题')).toHaveValue('第一章');
    expect(screen.getByLabelText('章节全文')).toHaveValue('这是第一章完整旁白文本。');
    expect(screen.getByRole('button', { name: /返回文本库/ })).toBeInTheDocument();
  });

  it('edits chapter title and text inside the chapter text view', () => {
    const onRenameChapter = vi.fn();
    const onUpdateChapterText = vi.fn();

    render(
      <ProjectLibrary
        chapters={[makeChapter('ch-1', '第一章', '旧文本')]}
        activeChapterId="ch-1"
        onSelectChapter={vi.fn()}
        onRenameChapter={onRenameChapter}
        onUpdateChapterText={onUpdateChapterText}
        onAddChapter={vi.fn()}
        onEnterStudio={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /打开文本/ }));
    fireEvent.change(screen.getByLabelText('章节标题'), { target: { value: '新标题' } });
    fireEvent.change(screen.getByLabelText('章节全文'), { target: { value: '新的完整旁白文本' } });

    expect(onRenameChapter).toHaveBeenCalledWith('ch-1', '新标题');
    expect(onUpdateChapterText).toHaveBeenCalledWith('ch-1', '新的完整旁白文本');
  });

  it('enters Studio from overview and chapter text view', () => {
    const onEnterStudio = vi.fn();

    render(
      <ProjectLibrary
        chapters={[makeChapter('ch-1', '第一章', '文本一')]}
        activeChapterId="ch-1"
        onSelectChapter={vi.fn()}
        onRenameChapter={vi.fn()}
        onUpdateChapterText={vi.fn()}
        onAddChapter={vi.fn()}
        onEnterStudio={onEnterStudio}
      />,
    );

    fireEvent.click(screen.getAllByRole('button', { name: /进入工作室/ })[0]);
    expect(onEnterStudio).toHaveBeenCalledWith('ch-1');

    fireEvent.click(screen.getByRole('button', { name: /打开文本/ }));
    fireEvent.click(screen.getByRole('button', { name: /进入工作室/ }));
    expect(onEnterStudio).toHaveBeenCalledWith('ch-1');
  });

  it('selects chapters and creates a new chapter from overview', () => {
    const onSelectChapter = vi.fn();
    const onAddChapter = vi.fn();

    render(
      <ProjectLibrary
        chapters={[
          makeChapter('ch-1', '第一章', '文本一'),
          makeChapter('ch-2', '第二章', '文本二'),
        ]}
        activeChapterId="ch-1"
        onSelectChapter={onSelectChapter}
        onRenameChapter={vi.fn()}
        onUpdateChapterText={vi.fn()}
        onAddChapter={onAddChapter}
        onEnterStudio={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /选择第二章/ }));
    fireEvent.click(screen.getByRole('button', { name: /新建章节/ }));

    expect(onSelectChapter).toHaveBeenCalledWith('ch-2');
    expect(onAddChapter).toHaveBeenCalled();
  });
});
