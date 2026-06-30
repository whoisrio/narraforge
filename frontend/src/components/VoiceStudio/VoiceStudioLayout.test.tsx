import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { VoiceStudioLayout } from './VoiceStudioLayout';

function renderStudio() {
  const onExport = vi.fn();
  const onPlayAll = vi.fn();
  const onSidebarCollapseChange = vi.fn();
  render(
    <VoiceStudioLayout
      segmentCount={12}
      generatedCount={8}
      durationSec={96}
      remotionPath="/tmp/remotion"
      onExport={onExport}
      onPlayAll={onPlayAll}
      onSidebarCollapseChange={onSidebarCollapseChange}
      sidebarContent={
        <>
          <section>Engine Controls</section>
          <section>Available Roles</section>
        </>
      }
    >
      <div data-testid="studio-segment-content">Segment content</div>
    </VoiceStudioLayout>,
  );
  return { onExport, onPlayAll, onSidebarCollapseChange };
}

describe('VoiceStudioLayout', () => {
  it('renders production content, right panel, and transport bar', () => {
    renderStudio();

    expect(screen.getByText('语音设置')).toBeInTheDocument();
    expect(screen.getByText('Available Roles')).toBeInTheDocument();
    // Transport bar is collapsed by default — expand it first
    fireEvent.click(screen.getByRole('button', { name: '展开播放栏' }));
    expect(screen.getByText('Master Transport')).toBeInTheDocument();
    expect(screen.getByText('/tmp/remotion')).toBeInTheDocument();
    expect(screen.getByTestId('studio-segment-content')).toBeInTheDocument();
  });

  it('wires play all and export actions', () => {
    const { onExport, onPlayAll } = renderStudio();

    // Transport bar is collapsed by default — expand it first
    fireEvent.click(screen.getByRole('button', { name: '展开播放栏' }));

    fireEvent.click(screen.getByRole('button', { name: '播放' }));
    fireEvent.click(screen.getByRole('button', { name: '导出' }));

    expect(onPlayAll).toHaveBeenCalled();
    expect(onExport).toHaveBeenCalled();
  });

  it('collapses and expands the studio right panel while notifying parent state', () => {
    const { onSidebarCollapseChange } = renderStudio();

    expect(screen.getByTestId('voice-studio-side-panel-toggle')).toHaveAccessibleName('收起右侧面板');

    fireEvent.click(screen.getByRole('button', { name: /收起右侧面板/ }));

    expect(screen.getByTestId('voice-studio-layout')).toHaveAttribute('data-side-panel-collapsed', 'true');
    expect(onSidebarCollapseChange).toHaveBeenCalledWith(true);
    expect(screen.getByTestId('voice-studio-side-panel-toggle')).toHaveAccessibleName('展开右侧面板');
    expect(screen.getByRole('button', { name: /展开右侧面板/ })).toBeInTheDocument();
    expect(screen.queryByText('Available Roles')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /展开右侧面板/ }));

    expect(screen.getByTestId('voice-studio-layout')).toHaveAttribute('data-side-panel-collapsed', 'false');
    expect(onSidebarCollapseChange).toHaveBeenCalledWith(false);
    expect(screen.getByText('Available Roles')).toBeInTheDocument();
  });

  it('exposes the right panel width without double-reserving center content space', () => {
    renderStudio();

    const root = screen.getByTestId('voice-studio-layout');
    const center = screen.getByTestId('voice-studio-main-content');
    const transport = screen.getByTestId('voice-studio-transport-bar');

    expect(root).toHaveStyle({ '--studio-right-panel-width': '300px' });
    expect(center).not.toHaveStyle({ marginRight: 'calc(var(--studio-right-panel-width) + 28px)' });
    expect(transport).toHaveStyle({ right: 'calc(var(--studio-right-panel-width) + 28px)' });

    fireEvent.click(screen.getByRole('button', { name: /收起右侧面板/ }));

    expect(root).toHaveStyle({ '--studio-right-panel-width': '48px' });
    expect(center).not.toHaveStyle({ marginRight: 'calc(var(--studio-right-panel-width) + 28px)' });
    expect(transport).toHaveStyle({ right: 'calc(var(--studio-right-panel-width) + 28px)' });
  });
});
