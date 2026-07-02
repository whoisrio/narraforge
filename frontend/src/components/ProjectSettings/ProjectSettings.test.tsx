import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ProjectSettings } from './ProjectSettings';

describe('ProjectSettings', () => {
  it('renders basic info and video project settings, and persists changes', () => {
    const onRenameProject = vi.fn();
    const onUpdateRemotionPath = vi.fn();
    const onUpdateProjectMeta = vi.fn();
    const onBackToOverview = vi.fn();

    render(
      <ProjectSettings
        projectName="草稿项目"
        remotionPath="/tmp/remotion"
        storageMode="frontend"
        chapterCount={2}
        projectDescription="给 DeepSeek 视频做旁白"
        exportDirectory="public/audio"
        onRenameProject={onRenameProject}
        onUpdateRemotionPath={onUpdateRemotionPath}
        onUpdateProjectMeta={onUpdateProjectMeta}
        onBackToOverview={onBackToOverview}
      />,
    );

    expect(screen.getByText('Project Settings')).toBeInTheDocument();
    expect(screen.getByLabelText('项目名称')).toHaveValue('草稿项目');
    expect(screen.getByLabelText('Remotion 项目路径')).toHaveValue('/tmp/remotion');
    expect(screen.getByText('浏览器存储')).toBeInTheDocument();
    expect(screen.getByText('2 章')).toBeInTheDocument();
    expect(screen.getByLabelText('项目描述')).toHaveValue('给 DeepSeek 视频做旁白');
    expect(screen.getByLabelText('默认导出目录')).toHaveValue('public/audio');

    fireEvent.change(screen.getByLabelText('项目名称'), { target: { value: '正式项目' } });
    fireEvent.change(screen.getByLabelText('Remotion 项目路径'), { target: { value: '/Users/rio/video' } });
    fireEvent.change(screen.getByLabelText('项目描述'), { target: { value: '新版项目描述' } });
    fireEvent.change(screen.getByLabelText('默认导出目录'), { target: { value: 'public/narration' } });
    fireEvent.click(screen.getByRole('button', { name: /返回总览/ }));

    expect(onRenameProject).toHaveBeenCalledWith('正式项目');
    expect(onUpdateRemotionPath).toHaveBeenCalledWith('/Users/rio/video');
    expect(onUpdateProjectMeta).toHaveBeenCalledWith({ description: '新版项目描述' });
    expect(onUpdateProjectMeta).toHaveBeenCalledWith({ export_directory: 'public/narration' });
    expect(onBackToOverview).toHaveBeenCalled();
  });
});
