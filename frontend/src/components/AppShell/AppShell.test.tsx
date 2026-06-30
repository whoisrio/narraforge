import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AppShell } from './AppShell';

function renderShell() {
  const onNavigate = vi.fn();
  render(
    <AppShell activeNavId="projects" onNavigate={onNavigate}>
      <div>Studio content</div>
    </AppShell>,
  );
  return { onNavigate };
}

describe('AppShell', () => {
  it('renders the global studio navigation in Chinese', () => {
    renderShell();

    expect(screen.getByText('NarraForge')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /项目/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /字幕识别/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /音色设计/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /设置/ })).toBeInTheDocument();
    expect(screen.getByText('Studio content')).toBeInTheDocument();
  });

  it('calls onNavigate with the selected global destination', () => {
    const { onNavigate } = renderShell();

    fireEvent.click(screen.getByRole('button', { name: /字幕识别/ }));

    expect(onNavigate).toHaveBeenCalledWith('subtitles');
  });

  it('collapses the sidebar while keeping icon-only navigation accessible', () => {
    renderShell();

    fireEvent.click(screen.getByRole('button', { name: /收起导航/ }));

    expect(screen.getByTestId('app-shell')).toHaveAttribute('data-collapsed', 'true');
    expect(screen.getByRole('button', { name: /展开导航/ })).toBeInTheDocument();
  });
});
