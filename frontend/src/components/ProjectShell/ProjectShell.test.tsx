import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ProjectShell } from './ProjectShell';

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
    expect(screen.getByRole('button', { name: /声音角色/ })).toBeInTheDocument();
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
});
