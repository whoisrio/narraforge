import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ProjectSettings } from './ProjectSettings';

describe('ProjectSettings', () => {
  it('renders project metadata, remotion/export settings, and persists changes', () => {
    const onRenameProject = vi.fn();
    const onUpdateRemotionPath = vi.fn();
    const onBackToOverview = vi.fn();

    render(
      <ProjectSettings
        projectName="草稿项目"
        remotionPath="/tmp/remotion"
        defaultNarratorName="默认旁白"
        storageMode="frontend"
        chapterCount={2}
        onRenameProject={onRenameProject}
        onUpdateRemotionPath={onUpdateRemotionPath}
        onBackToOverview={onBackToOverview}
      />,
    );

    expect(screen.getByText('Project Settings')).toBeInTheDocument();
    expect(screen.getByLabelText('项目名称')).toHaveValue('草稿项目');
    expect(screen.getByLabelText('Remotion 项目路径')).toHaveValue('/tmp/remotion');
    expect(screen.getAllByText('默认旁白').length).toBeGreaterThan(0);
    expect(screen.getByText('frontend')).toBeInTheDocument();
    expect(screen.getByText('2 章')).toBeInTheDocument();
    expect(screen.getByText('Studio 导出')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('项目名称'), { target: { value: '正式项目' } });
    fireEvent.change(screen.getByLabelText('Remotion 项目路径'), { target: { value: '/Users/rio/video' } });
    fireEvent.click(screen.getByRole('button', { name: /返回总览/ }));

    expect(onRenameProject).toHaveBeenCalledWith('正式项目');
    expect(onUpdateRemotionPath).toHaveBeenCalledWith('/Users/rio/video');
    expect(onBackToOverview).toHaveBeenCalled();
  });
});
