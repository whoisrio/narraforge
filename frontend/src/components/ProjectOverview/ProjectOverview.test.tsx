import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Chapter, Role } from '../../types';
import { ProjectOverview } from './ProjectOverview';

const roles: Role[] = [
  {
    id: 'role-narrator',
    name: '默认旁白',
    description: 'Narrator',
    default_engine: 'edge_tts',
    default_voice: 'Yunxi',
    default_engine_params: { engine: 'edge_tts', edge_voice: 'zh-CN-YunxiNeural' },
    favorite_styles: [],
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  },
];

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
    voice: { engine: 'edge_tts', voice: '', rate: '+0%', volume: '+0%' },
    split_config: { delimiters: ['。'], mode: 'rule' },
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
  },
  {
    id: 'ch-2',
    name: '第二章',
    segments: [],
    voice: { engine: 'edge_tts', voice: '', rate: '+0%', volume: '+0%' },
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
        remotionPath="/tmp/remotion"
        roles={roles}
        onEnterLibrary={onEnterLibrary}
        onEnterStudio={onEnterStudio}
        onOpenVoices={onOpenVoices}
        onOpenSettings={onOpenSettings}
      />,
    );

    expect(screen.getByText('Production Progress')).toBeInTheDocument();
    expect(screen.getByText('Manuscript Quick Access')).toBeInTheDocument();
    expect(screen.queryByText('0/2 Chapters Synthesized')).not.toBeInTheDocument();
    expect(screen.getByText('默认旁白')).toBeInTheDocument();
    expect(screen.getByText('/tmp/remotion')).toBeInTheDocument();

    const activeChapterCard = screen.getByLabelText('章节 开场叙事');
    expect(activeChapterCard).toHaveAttribute('data-chapter-card', 'compact');
    expect(activeChapterCard).toHaveTextContent('01');
    expect(activeChapterCard).toHaveTextContent('2 段 · 1 已生成 · 0:06');
    expect(activeChapterCard.querySelector('[class*="chapterProgressTrack"]')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /View All Chapters/ }));
    fireEvent.click(screen.getByRole('button', { name: /ASSIGN CHARACTER/ }));

    expect(onEnterLibrary).toHaveBeenCalled();
    expect(onEnterStudio).not.toHaveBeenCalled();
    expect(onOpenVoices).toHaveBeenCalled();
    expect(onOpenSettings).not.toHaveBeenCalled();
  });
});
