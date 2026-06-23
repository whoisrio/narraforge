import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Chapter } from '../../types';
import { ProjectOverview } from './ProjectOverview';

const chapters: Chapter[] = [
  {
    id: 'ch-1',
    name: '第一章',
    design_title: '开场叙事',
    original_text: '这是一段章节全文，用于概览展示。',
    segments: [
      { id: 's1', text: '旁白', params: { engine: 'edge_tts' }, status: 'ready', duration_sec: 6, created_at: '2026-01-01', updated_at: '2026-01-01' },
      { id: 's2', text: '台词', params: { engine: 'edge_tts' }, status: 'idle', created_at: '2026-01-01', updated_at: '2026-01-01' },
    ],
    default_params: { engine: 'edge_tts' },
    split_config: { delimiters: ['。'], mode: 'rule' },
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
  },
  {
    id: 'ch-2',
    name: '第二章',
    segments: [],
    default_params: { engine: 'edge_tts' },
    split_config: { delimiters: ['。'], mode: 'rule' },
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
  },
];

describe('ProjectOverview', () => {
  it('renders project status, chapter progress, and primary handoff actions', () => {
    const onEnterLibrary = vi.fn();
    const onEnterStudio = vi.fn();
    const onOpenVoices = vi.fn();
    const onOpenSettings = vi.fn();

    render(
      <ProjectOverview
        projectName="草稿项目"
        chapters={chapters}
        activeChapterId="ch-1"
        defaultNarratorName="默认旁白"
        remotionPath="/tmp/remotion"
        onEnterLibrary={onEnterLibrary}
        onEnterStudio={onEnterStudio}
        onOpenVoices={onOpenVoices}
        onOpenSettings={onOpenSettings}
      />,
    );

    expect(screen.getByText('Project Overview')).toBeInTheDocument();
    expect(screen.getByText('草稿项目')).toBeInTheDocument();
    expect(screen.getByText('2 章')).toBeInTheDocument();
    expect(screen.getByText('2 段')).toBeInTheDocument();
    expect(screen.getByText('1 已生成')).toBeInTheDocument();
    expect(screen.getByText('0:06')).toBeInTheDocument();
    expect(screen.getByText('默认旁白')).toBeInTheDocument();
    expect(screen.getByText('/tmp/remotion')).toBeInTheDocument();
    expect(screen.getAllByText('开场叙事').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: /打开文本库/ }));
    fireEvent.click(screen.getByRole('button', { name: /进入工作室/ }));
    fireEvent.click(screen.getByRole('button', { name: /配置声音角色/ }));
    fireEvent.click(screen.getByRole('button', { name: /项目设置/ }));

    expect(onEnterLibrary).toHaveBeenCalled();
    expect(onEnterStudio).toHaveBeenCalled();
    expect(onOpenVoices).toHaveBeenCalled();
    expect(onOpenSettings).toHaveBeenCalled();
  });
});
