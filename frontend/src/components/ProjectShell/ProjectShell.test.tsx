import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ProjectShell } from './ProjectShell';

vi.mock('../../services/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/api')>();
  return {
    ...actual,
    segmentedProjectApi: {
      ...actual.segmentedProjectApi,
      getSyncStatus: vi.fn().mockResolvedValue({ l1_dirty: false, l2_dirty: true, l3_dirty: false }),
      resplitFromScript: vi.fn().mockRejectedValue(new Error('boom')),
      rewriteScriptFromSegments: vi.fn().mockRejectedValue(new Error('boom')),
    },
  };
});

function renderProjectShell(activeSection: 'overview' | 'library' | 'studio' | 'voices' | 'settings' = 'studio') {
  const onSectionChange = vi.fn();
  const onBackToProjects = vi.fn();
  render(
    <ProjectShell
      projectName="草稿项目"
      projectSubtitle="快速试稿"
      activeSection={activeSection}
      locale="zh-CN"
      chapterName="第一章"
      segmentCount={12}
      generatedCount={8}
      durationSec={96}
      onSectionChange={onSectionChange}
      onBackToProjects={onBackToProjects}
    >
      <div>Studio content</div>
    </ProjectShell>,
  );
  return { onSectionChange, onBackToProjects };
}

describe('ProjectShell', () => {
  it('renders project-level navigation without an exports entry', () => {
    renderProjectShell();

    expect(screen.getByTestId('project-shell')).toHaveAttribute('data-sidebar', 'fixed-left');
    expect(screen.getAllByText('草稿项目').length).toBeGreaterThan(0);
    expect(screen.getByText('快速试稿')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^◇总览$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /文本库/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /工作室/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /角色/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /项目设置/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Exports|导出中心/ })).not.toBeInTheDocument();
  });

  it('marks the active project section and renders production context in the breadcrumb line', () => {
    renderProjectShell('studio');

    expect(screen.getByRole('button', { name: /工作室/ })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByLabelText('Project workspace context')).toHaveTextContent('草稿项目/工作室/ 第一章 · 12 段 · 8 已生成 · 1:36');
    expect(screen.getByText('Studio content')).toBeInTheDocument();
  });

  it('calls onSectionChange when selecting Library', () => {
    const { onSectionChange } = renderProjectShell();

    fireEvent.click(screen.getByRole('button', { name: /文本库/ }));

    expect(onSectionChange).toHaveBeenCalledWith('library');
  });

  it('uses breadcrumb-only workspace chrome instead of duplicate section headers or stat cards', () => {
    renderProjectShell('library');

    const shell = screen.getByTestId('project-shell');
    const context = screen.getByLabelText('Project workspace context');
    expect(shell).toHaveAttribute('data-workspace-chrome', 'breadcrumb-only');
    expect(screen.queryByRole('heading', { level: 1, name: '文本库' })).not.toBeInTheDocument();
    expect(context).toHaveTextContent('草稿项目/文本库');
    expect(context).toHaveTextContent('第一章 · 12 段 · 8 已生成 · 1:36');
    expect(context.querySelector('[data-testid="workspace-stat-card"]')).toBeNull();
  });

  it('provides a visible way to return to the global project hub', () => {
    const { onBackToProjects } = renderProjectShell();

    fireEvent.click(screen.getByRole('button', { name: /返回项目总览/ }));

    expect(onBackToProjects).toHaveBeenCalled();
  });

  it('collapses and expands the project sidebar while keeping nav accessible', () => {
    renderProjectShell();

    fireEvent.click(screen.getByRole('button', { name: /收起项目导航/ }));

    expect(screen.getByTestId('project-shell')).toHaveAttribute('data-collapsed', 'true');
    expect(screen.getByRole('button', { name: /展开项目导航/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /工作室/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /展开项目导航/ }));

    expect(screen.getByTestId('project-shell')).toHaveAttribute('data-collapsed', 'false');
  });

  it('renders chapter rows as compact cards without nested buttons', () => {
    const onSelectChapter = vi.fn();
    render(
      <ProjectShell
        projectName="草稿项目"
        activeSection="studio"
        locale="zh-CN"
        chapterName="第一章"
        chapters={[
          { id: 'ch-1', name: '第一章', segments: [], voice: { engine: 'edge_tts', voice: '', rate: '+0%', volume: '+0%' }, split_config: { delimiters: ['。'], mode: 'rule' }, created_at: '2026-01-01', updated_at: '2026-01-01' },
          { id: 'ch-2', name: '第二章', segments: [], voice: { engine: 'edge_tts', voice: '', rate: '+0%', volume: '+0%' }, split_config: { delimiters: ['。'], mode: 'rule' }, created_at: '2026-01-01', updated_at: '2026-01-01' },
        ]}
        activeChapterId="ch-1"
        onSelectChapter={onSelectChapter}
        onRenameChapter={vi.fn()}
        onDeleteChapter={vi.fn()}
        onSectionChange={vi.fn()}
      >
        <div>Studio content</div>
      </ProjectShell>,
    );

    const row = screen.getByRole('button', { name: '选择章节 第一章' }).closest('[data-chapter-card="compact"]');
    expect(row).toBeInTheDocument();
    expect(row?.querySelector('button button')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '选择章节 第二章' }));

    expect(onSelectChapter).toHaveBeenCalledWith('ch-2');
  });

  it('renders chapter move up/down buttons and invokes onMoveChapter', () => {
    const onMoveChapter = vi.fn();
    render(
      <ProjectShell
        projectName="草稿项目"
        activeSection="studio"
        locale="zh-CN"
        chapterName="第一章"
        chapters={[
          { id: 'ch-1', name: '第一章', segments: [], voice: { engine: 'edge_tts', voice: '', rate: '+0%', volume: '+0%' }, split_config: { delimiters: ['。'], mode: 'rule' }, created_at: '2026-01-01', updated_at: '2026-01-01' },
          { id: 'ch-2', name: '第二章', segments: [], voice: { engine: 'edge_tts', voice: '', rate: '+0%', volume: '+0%' }, split_config: { delimiters: ['。'], mode: 'rule' }, created_at: '2026-01-01', updated_at: '2026-01-01' },
          { id: 'ch-3', name: '第三章', segments: [], voice: { engine: 'edge_tts', voice: '', rate: '+0%', volume: '+0%' }, split_config: { delimiters: ['。'], mode: 'rule' }, created_at: '2026-01-01', updated_at: '2026-01-01' },
        ]}
        activeChapterId="ch-1"
        onSelectChapter={vi.fn()}
        onRenameChapter={vi.fn()}
        onDeleteChapter={vi.fn()}
        onMoveChapter={onMoveChapter}
        onSectionChange={vi.fn()}
      >
        <div>Studio content</div>
      </ProjectShell>,
    );

    // Middle chapter can move both ways
    fireEvent.click(screen.getByRole('button', { name: '上移章节 第二章' }));
    expect(onMoveChapter).toHaveBeenCalledWith('ch-2', 'up');
    fireEvent.click(screen.getByRole('button', { name: '下移章节 第二章' }));
    expect(onMoveChapter).toHaveBeenCalledWith('ch-2', 'down');

    // First chapter: move up disabled, move down enabled
    expect(screen.getByRole('button', { name: '上移章节 第一章' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '下移章节 第一章' })).toBeEnabled();

    // Last chapter: move up enabled, move down disabled
    expect(screen.getByRole('button', { name: '上移章节 第三章' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '下移章节 第三章' })).toBeDisabled();
  });

  it('does not render chapter move buttons when onMoveChapter is not provided', () => {
    render(
      <ProjectShell
        projectName="草稿项目"
        activeSection="studio"
        locale="zh-CN"
        chapterName="第一章"
        chapters={[
          { id: 'ch-1', name: '第一章', segments: [], voice: { engine: 'edge_tts', voice: '', rate: '+0%', volume: '+0%' }, split_config: { delimiters: ['。'], mode: 'rule' }, created_at: '2026-01-01', updated_at: '2026-01-01' },
        ]}
        activeChapterId="ch-1"
        onSelectChapter={vi.fn()}
        onRenameChapter={vi.fn()}
        onDeleteChapter={vi.fn()}
        onSectionChange={vi.fn()}
      >
        <div>Studio content</div>
      </ProjectShell>,
    );

    expect(screen.queryByRole('button', { name: /上移章节/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /下移章节/ })).not.toBeInTheDocument();
  });

  it('alerts a failure message (not "syncing") when resplit-from-script fails', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(
      <ProjectShell
        projectId="p1"
        projectName="草稿项目"
        activeSection="studio"
        locale="zh-CN"
        chapterName="第一章"
        chapters={[
          { id: 'ch-1', name: '第一章', segments: [], voice: { engine: 'edge_tts', voice: '', rate: '+0%', volume: '+0%' }, split_config: { delimiters: ['。'], mode: 'rule' }, created_at: '2026-01-01', updated_at: '2026-01-01' },
        ]}
        activeChapterId="ch-1"
        onSelectChapter={vi.fn()}
        onRenameChapter={vi.fn()}
        onDeleteChapter={vi.fn()}
        onSectionChange={vi.fn()}
      >
        <div>Studio content</div>
      </ProjectShell>,
    );

    // 等待 sync badge 出现并打开同步弹窗
    const badge = await screen.findByLabelText('该章节文本已改动，与上下游不一致');
    fireEvent.click(badge);
    fireEvent.click(await screen.findByRole('button', { name: '以改写稿重新拆分' }));

    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    const message = alertSpy.mock.calls[0][0];
    expect(message).not.toBe('同步中…');
    expect(message).toBe('同步失败，请稍后重试');
  });
});
