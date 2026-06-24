import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { VoiceStudioLayout } from './VoiceStudioLayout';

function renderStudio(viewMode: 'list' | 'dialogue' = 'list') {
  const onViewModeChange = vi.fn();
  const onBatchSynthesize = vi.fn();
  const onExport = vi.fn();
  const onPlayAll = vi.fn();
  render(
    <VoiceStudioLayout
      projectName="草稿项目"
      chapterName="第一章"
      engineLabel="Edge-TTS"
      voiceRoleLabel="默认旁白"
      segmentCount={12}
      generatedCount={8}
      durationSec={96}
      queueCount={2}
      narratorRoles={[{ id: 'role-narrator', name: '默认旁白' }]}
      castRoles={[{ id: 'role-guest-a', name: '嘉宾A' }]}
      viewMode={viewMode}
      remotionPath="/tmp/remotion"
      onViewModeChange={onViewModeChange}
      onBatchSynthesize={onBatchSynthesize}
      onExport={onExport}
      onPlayAll={onPlayAll}
    >
      <div data-testid="studio-segment-content">Segment content</div>
    </VoiceStudioLayout>,
  );
  return { onViewModeChange, onBatchSynthesize, onExport, onPlayAll };
}

describe('VoiceStudioLayout', () => {
  it('renders studio header, production content, side panel, and transport bar', () => {
    renderStudio();

    expect(screen.getByText('Voice Studio')).toBeInTheDocument();
    expect(screen.getByText('草稿项目')).toBeInTheDocument();
    expect(screen.getAllByText('第一章').length).toBeGreaterThan(0);
    expect(screen.getByText('Production Timeline')).toBeInTheDocument();
    expect(screen.getByText('Session Monitor')).toBeInTheDocument();
    expect(screen.getByText('Synthesis Queue')).toBeInTheDocument();
    expect(screen.getByText('Global Engine')).toBeInTheDocument();
    expect(screen.getByText('Available Roles')).toBeInTheDocument();
    expect(screen.getByText('Master Transport')).toBeInTheDocument();
    expect(screen.getByTestId('studio-segment-content')).toBeInTheDocument();
  });

  it('surfaces production stats and remotion export target', () => {
    renderStudio();

    expect(screen.getByText('12 段')).toBeInTheDocument();
    expect(screen.getByText('8 已生成')).toBeInTheDocument();
    expect(screen.getAllByText('1:36').length).toBeGreaterThan(0);
    expect(screen.getByText('2 active')).toBeInTheDocument();
    expect(screen.getByText('/tmp/remotion')).toBeInTheDocument();
    expect(screen.getByText('Edge-TTS')).toBeInTheDocument();
    expect(screen.getAllByText('默认旁白').length).toBeGreaterThan(0);
    expect(screen.getByText('Narrator')).toBeInTheDocument();
    expect(screen.getByText('嘉宾A')).toBeInTheDocument();
  });

  it('keeps list and dialogue mode switches wired', () => {
    const { onViewModeChange } = renderStudio('list');

    fireEvent.click(screen.getByRole('button', { name: /对话视图/ }));

    expect(onViewModeChange).toHaveBeenCalledWith('dialogue');
    expect(screen.getByRole('button', { name: /列表视图/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('wires batch synthesize, play all, and export actions', () => {
    const { onBatchSynthesize, onExport, onPlayAll } = renderStudio();

    fireEvent.click(screen.getByRole('button', { name: /批量合成/ }));
    fireEvent.click(screen.getByRole('button', { name: /全部播放/ }));
    fireEvent.click(screen.getByRole('button', { name: /导出/ }));

    expect(onBatchSynthesize).toHaveBeenCalled();
    expect(onPlayAll).toHaveBeenCalled();
    expect(onExport).toHaveBeenCalled();
  });

  it('collapses and expands the studio right panel', () => {
    renderStudio();

    fireEvent.click(screen.getByRole('button', { name: /收起右侧面板/ }));

    expect(screen.getByTestId('voice-studio-layout')).toHaveAttribute('data-side-panel-collapsed', 'true');
    expect(screen.getByRole('button', { name: /展开右侧面板/ })).toBeInTheDocument();
    expect(screen.queryByText('Session Monitor')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /展开右侧面板/ }));

    expect(screen.getByTestId('voice-studio-layout')).toHaveAttribute('data-side-panel-collapsed', 'false');
    expect(screen.getByText('Session Monitor')).toBeInTheDocument();
  });
});
