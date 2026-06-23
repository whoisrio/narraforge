import { fireEvent, render, screen } from '@testing-library/react';
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
  it('renders global project overview cards instead of project workspace navigation', () => {
    render(
      <ProjectHub
        projects={[makeProject('p-1', 'DeepSeek 解说', 2, 3)]}
        onOpenProject={vi.fn()}
        onCreateProject={vi.fn()}
      />,
    );

    expect(screen.getByText('Project Hub')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /新建项目/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /DeepSeek 解说/ })).toBeInTheDocument();
    expect(screen.getByText('2 章')).toBeInTheDocument();
    expect(screen.getByText('6 段')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /文本库/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /工作室/ })).not.toBeInTheDocument();
  });

  it('opens a project only after clicking its card', () => {
    const onOpenProject = vi.fn();

    render(
      <ProjectHub
        projects={[makeProject('p-1', 'DeepSeek 解说', 1, 2)]}
        onOpenProject={onOpenProject}
        onCreateProject={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /DeepSeek 解说/ }));

    expect(onOpenProject).toHaveBeenCalledWith('p-1');
  });

  it('creates a project from the new project card', () => {
    const onCreateProject = vi.fn();

    render(<ProjectHub projects={[]} onOpenProject={vi.fn()} onCreateProject={onCreateProject} />);

    fireEvent.click(screen.getByRole('button', { name: /新建项目/ }));

    expect(onCreateProject).toHaveBeenCalled();
    expect(screen.getByText('还没有项目')).toBeInTheDocument();
  });
});
