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
        underscoreToSpace={true}
        skipParenthesized={false}
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
    expect(screen.getByLabelText('合成时把下划线转为空格')).toBeChecked();

    // 忽略选项是可展开组：组标题可见，两个开关都在组内
    expect(screen.getByRole('button', { name: /合成忽略选项/ })).toBeInTheDocument();
    expect(screen.getByLabelText('合成时忽略括号内容')).not.toBeChecked();

    fireEvent.change(screen.getByLabelText('项目名称'), { target: { value: '正式项目' } });
    fireEvent.change(screen.getByLabelText('Remotion 项目路径'), { target: { value: '/Users/rio/video' } });
    fireEvent.change(screen.getByLabelText('项目描述'), { target: { value: '新版项目描述' } });
    fireEvent.change(screen.getByLabelText('默认导出目录'), { target: { value: 'public/narration' } });
    fireEvent.click(screen.getByLabelText('合成时把下划线转为空格'));
    fireEvent.click(screen.getByLabelText('合成时忽略括号内容'));
    fireEvent.click(screen.getByRole('button', { name: /返回总览/ }));

    expect(onRenameProject).toHaveBeenCalledWith('正式项目');
    expect(onUpdateRemotionPath).toHaveBeenCalledWith('/Users/rio/video');
    expect(onUpdateProjectMeta).toHaveBeenCalledWith({ description: '新版项目描述' });
    expect(onUpdateProjectMeta).toHaveBeenCalledWith({ export_directory: 'public/narration' });
    expect(onUpdateProjectMeta).toHaveBeenCalledWith({ underscore_to_space: false });
    expect(onUpdateProjectMeta).toHaveBeenCalledWith({ skip_parenthesized: true });
    expect(onBackToOverview).toHaveBeenCalled();
  });

  it('ignore-options group expands and collapses on header click', () => {
    render(
      <ProjectSettings
        projectName="草稿项目"
        remotionPath={null}
        storageMode="frontend"
        chapterCount={1}
        underscoreToSpace={null}
        skipParenthesized={null}
        onRenameProject={vi.fn()}
        onUpdateRemotionPath={vi.fn()}
        onUpdateProjectMeta={vi.fn()}
        onBackToOverview={vi.fn()}
      />,
    );

    const header = screen.getByRole('button', { name: /合成忽略选项/ });
    // 默认收起
    expect(header).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'false');
  });
});
