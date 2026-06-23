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
  it('renders chapter list and the active chapter full text', () => {
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

    expect(screen.getByRole('button', { name: /第一章/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /第二章/ })).toBeInTheDocument();
    expect(screen.getByDisplayValue('这是第一章完整旁白文本。')).toBeInTheDocument();
    expect(screen.getByText('12 字')).toBeInTheDocument();
    expect(screen.getByText('预计 2.4s')).toBeInTheDocument();
    expect(screen.getByText('3 段')).toBeInTheDocument();
  });

  it('updates title and full text for the active chapter', () => {
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

    fireEvent.change(screen.getByLabelText('章节标题'), { target: { value: '新标题' } });
    fireEvent.change(screen.getByLabelText('章节全文'), { target: { value: '新的完整旁白文本' } });

    expect(onRenameChapter).toHaveBeenCalledWith('ch-1', '新标题');
    expect(onUpdateChapterText).toHaveBeenCalledWith('ch-1', '新的完整旁白文本');
  });

  it('selects chapters, adds a chapter, and enters Studio for the active chapter', () => {
    const onSelectChapter = vi.fn();
    const onAddChapter = vi.fn();
    const onEnterStudio = vi.fn();

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
        onEnterStudio={onEnterStudio}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /第二章/ }));
    fireEvent.click(screen.getByRole('button', { name: /新建章节/ }));
    fireEvent.click(screen.getByRole('button', { name: /进入工作室/ }));

    expect(onSelectChapter).toHaveBeenCalledWith('ch-2');
    expect(onAddChapter).toHaveBeenCalled();
    expect(onEnterStudio).toHaveBeenCalledWith('ch-1');
  });
});
