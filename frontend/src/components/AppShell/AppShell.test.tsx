import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AppShell } from './AppShell';

function renderShell(locale: 'zh-CN' | 'en-US' = 'zh-CN') {
  const onNavigate = vi.fn();
  render(
    <AppShell activeNavId="projects" locale={locale} onNavigate={onNavigate}>
      <div>Studio content</div>
    </AppShell>,
  );
  return { onNavigate };
}

describe('AppShell', () => {
  it('renders the global studio navigation in Chinese', () => {
    renderShell('zh-CN');

    expect(screen.getByText('NarraForge')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /项目/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /字幕识别/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /音色设计/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /设置/ })).toBeInTheDocument();
    expect(screen.getByText('Studio content')).toBeInTheDocument();
  });

  it('renders English navigation labels when locale is en-US', () => {
    renderShell('en-US');

    expect(screen.getByRole('button', { name: /Projects/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Subtitles/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Voice Design/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Settings/ })).toBeInTheDocument();
  });

  it('shows the header labels as status context instead of unexplained action buttons', () => {
    renderShell('zh-CN');

    expect(screen.getByText('Warm amber theme')).toBeInTheDocument();
    expect(screen.getByText('本地工作区')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Warm Amber Studio/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Local workspace/i })).not.toBeInTheDocument();
  });

  it('calls onNavigate with the selected global destination', () => {
    const { onNavigate } = renderShell('zh-CN');

    fireEvent.click(screen.getByRole('button', { name: /字幕识别/ }));

    expect(onNavigate).toHaveBeenCalledWith('subtitles');
  });

  it('collapses the sidebar while keeping icon-only navigation accessible', () => {
    renderShell('zh-CN');

    fireEvent.click(screen.getByRole('button', { name: /收起导航/ }));

    expect(screen.getByTestId('app-shell')).toHaveAttribute('data-collapsed', 'true');
    expect(screen.getByRole('button', { name: /展开导航/ })).toBeInTheDocument();
  });
});
