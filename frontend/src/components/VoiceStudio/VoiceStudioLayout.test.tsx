import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { VoiceStudioLayout } from './VoiceStudioLayout';

function renderStudio() {
  const onExport = vi.fn();
  const onSidebarCollapseChange = vi.fn();
  render(
    <VoiceStudioLayout
      segmentCount={12}
      generatedCount={8}
      durationSec={96}
      remotionPath="/tmp/remotion"
      onExport={onExport}
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
  return { onExport, onSidebarCollapseChange };
}

describe('VoiceStudioLayout', () => {
  it('renders production content, right panel, and transport bar', () => {
    renderStudio();

    expect(screen.getByText('语音设置')).toBeInTheDocument();
    expect(screen.getByText('Available Roles')).toBeInTheDocument();
    // Transport bar is collapsed by default — expand it first
    fireEvent.click(screen.getByRole('button', { name: '展开工具栏' }));
    expect(screen.getByText('Master Transport')).toBeInTheDocument();
    expect(screen.getByText('/tmp/remotion')).toBeInTheDocument();
    expect(screen.getByTestId('studio-segment-content')).toBeInTheDocument();
  });

  it('wires export actions and has no playback controls', () => {
    const { onExport } = renderStudio();

    // Transport bar is collapsed by default — expand it first
    fireEvent.click(screen.getByRole('button', { name: '展开工具栏' }));

    expect(screen.queryByRole('button', { name: '播放' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '导出' }));

    expect(onExport).toHaveBeenCalled();
  });

  it('renders 导出全部 only when onExportAll is provided and wires it', () => {
    const onExportAll = vi.fn();
    const onExport = vi.fn();
    render(
      <VoiceStudioLayout
        segmentCount={1}
        generatedCount={1}
        durationSec={10}
        remotionPath={null}
        onExport={onExport}
        onExportAll={onExportAll}
        onSidebarCollapseChange={vi.fn()}
        sidebarContent={<section>side</section>}
      >
        <div>content</div>
      </VoiceStudioLayout>,
    );
    fireEvent.click(screen.getByRole('button', { name: '展开工具栏' }));

    fireEvent.click(screen.getByRole('button', { name: '导出全部' }));
    expect(onExportAll).toHaveBeenCalled();
  });

  it('hides 导出全部 when onExportAll is absent', () => {
    renderStudio();
    fireEvent.click(screen.getByRole('button', { name: '展开工具栏' }));
    expect(screen.queryByRole('button', { name: '导出全部' })).not.toBeInTheDocument();
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

  it('renders 一键制作全本 dropdown when onProduceAll is provided and wires mode', () => {
    const onProduceAll = vi.fn();
    render(
      <VoiceStudioLayout
        segmentCount={5}
        generatedCount={2}
        durationSec={30}
        remotionPath={null}
        onExport={vi.fn()}
        onProduceAll={onProduceAll}
        onSidebarCollapseChange={vi.fn()}
        sidebarContent={<section>side</section>}
      >
        <div>content</div>
      </VoiceStudioLayout>,
    );
    fireEvent.click(screen.getByRole('button', { name: '展开工具栏' }));
    fireEvent.click(screen.getByRole('button', { name: /一键制作全本/ }));
    fireEvent.click(screen.getByText('仅合成未合成'));
    expect(onProduceAll).toHaveBeenCalledWith('unsynthesized');

    fireEvent.click(screen.getByRole('button', { name: /一键制作全本/ }));
    fireEvent.click(screen.getByText('重新合成全部'));
    expect(onProduceAll).toHaveBeenCalledWith('all');
  });

  it('hides 一键制作全本 when onProduceAll is absent', () => {
    renderStudio();
    fireEvent.click(screen.getByRole('button', { name: '展开工具栏' }));
    expect(screen.queryByRole('button', { name: /一键制作全本/ })).not.toBeInTheDocument();
  });
