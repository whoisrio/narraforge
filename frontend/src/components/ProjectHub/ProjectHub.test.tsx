import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { SegmentedProject } from '../../types';
import { ProjectHub } from './ProjectHub';

function makeProject(id: string, name: string, chapters: number, segmentsPerChapter: number): SegmentedProject {
  const now = '2026-01-01T00:00:00.000Z';
  return {
    schema_version: 2,
    id,
    name,
    active_chapter_id: `${id}-ch-0`,
    layout: 'vertical',
    chapters: Array.from({ length: chapters }, (_, chapterIndex) => ({
      id: `${id}-ch-${chapterIndex}`,
      name: `第 ${chapterIndex + 1} 章`,
      segments: Array.from({ length: segmentsPerChapter }, (_, segmentIndex) => ({
        id: `${id}-s-${chapterIndex}-${segmentIndex}`,
        text: `segment ${segmentIndex}`,
        params: { engine: 'edge_tts', edge_voice: 'zh-CN-YunxiNeural', language: 'Chinese' },
        status: segmentIndex % 2 === 0 ? 'ready' : 'idle',
        duration_sec: segmentIndex % 2 === 0 ? 5 : undefined,
        created_at: now,
        updated_at: now,
      })),
      default_params: { engine: 'edge_tts', edge_voice: 'zh-CN-YunxiNeural', language: 'Chinese' },
      split_config: { delimiters: ['。'], mode: 'rule' },
      created_at: now,
      updated_at: now,
    })),
    created_at: now,
    updated_at: now,
  };
}

describe('ProjectHub', () => {
  it('renders design-style project cards with a compact action menu instead of low inline buttons', () => {
    render(
      <ProjectHub
        projects={[makeProject('p-1', 'DeepSeek 解说', 2, 3)]}
        onOpenProject={vi.fn()}
        onCreateProject={vi.fn()}
        onDeleteProject={vi.fn()}
        onRenameProject={vi.fn()}
      />,
    );

    const card = screen.getByLabelText('项目 DeepSeek 解说');
    expect(screen.getByText('Project Hub')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /新建项目/ })).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: /打开 DeepSeek 解说/ })).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: /项目操作 DeepSeek 解说/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^删除 DeepSeek 解说$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^重命名 DeepSeek 解说$/ })).not.toBeInTheDocument();
    expect(screen.getByText('2 章')).toBeInTheDocument();
    expect(screen.getByText('6 段')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /文本库/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /工作室/ })).not.toBeInTheDocument();
  });

  it('opens a project from the card body or menu open action', () => {
    const onOpenProject = vi.fn();

    render(
      <ProjectHub
        projects={[makeProject('p-1', 'DeepSeek 解说', 1, 2)]}
        onOpenProject={onOpenProject}
        onCreateProject={vi.fn()}
        onDeleteProject={vi.fn()}
        onRenameProject={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /打开 DeepSeek 解说/ }));
    expect(onOpenProject).toHaveBeenCalledWith('p-1');

    fireEvent.click(screen.getByRole('button', { name: /项目操作 DeepSeek 解说/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: /打开项目/ }));
    expect(onOpenProject).toHaveBeenCalledTimes(2);
  });

  it('keeps menu management actions from opening the project', () => {
    const onOpenProject = vi.fn();
    const onDeleteProject = vi.fn();
    const onRenameProject = vi.fn();

    render(
      <ProjectHub
        projects={[makeProject('p-1', 'DeepSeek 解说', 1, 2)]}
        onOpenProject={onOpenProject}
        onCreateProject={vi.fn()}
        onDeleteProject={onDeleteProject}
        onRenameProject={onRenameProject}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /项目操作 DeepSeek 解说/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: /删除项目/ }));
    expect(onDeleteProject).toHaveBeenCalledWith('p-1');
    expect(onOpenProject).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /项目操作 DeepSeek 解说/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: /重命名/ }));
    fireEvent.change(screen.getByLabelText('项目名称'), { target: { value: '新版项目名' } });
    fireEvent.click(screen.getByRole('button', { name: /保存项目名称/ }));

    expect(onRenameProject).toHaveBeenCalledWith('p-1', '新版项目名');
    expect(onOpenProject).not.toHaveBeenCalled();
  });

  it('does not save an empty project rename', () => {
    const onRenameProject = vi.fn();

    render(
      <ProjectHub
        projects={[makeProject('p-1', 'DeepSeek 解说', 1, 2)]}
        onOpenProject={vi.fn()}
        onCreateProject={vi.fn()}
        onDeleteProject={vi.fn()}
        onRenameProject={onRenameProject}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /项目操作 DeepSeek 解说/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: /重命名/ }));
    fireEvent.change(screen.getByLabelText('项目名称'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: /保存项目名称/ }));

    expect(onRenameProject).not.toHaveBeenCalled();
    expect(screen.getByText('DeepSeek 解说')).toBeInTheDocument();
  });

  it('creates a project from the new project card', () => {
    const onCreateProject = vi.fn();

    render(<ProjectHub projects={[]} onOpenProject={vi.fn()} onCreateProject={onCreateProject} onDeleteProject={vi.fn()} onRenameProject={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /新建项目/ }));

    expect(onCreateProject).toHaveBeenCalled();
    expect(screen.getByText('还没有项目')).toBeInTheDocument();
  });
});
