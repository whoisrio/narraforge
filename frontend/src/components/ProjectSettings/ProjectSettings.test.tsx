import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ProjectSettings } from './ProjectSettings';

describe('ProjectSettings', () => {
  it('renders project metadata, remotion/export settings, and persists changes', () => {
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
        projectType="explainer"
        defaultLanguage="zh-CN"
        exportDirectory="public/audio"
        exportNamingTemplate="{project}-{chapter}-{date}"
        onRenameProject={onRenameProject}
        onUpdateRemotionPath={onUpdateRemotionPath}
        onUpdateProjectMeta={onUpdateProjectMeta}
        onBackToOverview={onBackToOverview}
      />,
    );

    expect(screen.getByText('Project Settings')).toBeInTheDocument();
    expect(screen.getByLabelText('项目名称')).toHaveValue('草稿项目');
    expect(screen.getByLabelText('Remotion 项目路径')).toHaveValue('/tmp/remotion');
    expect(screen.getByText('frontend')).toBeInTheDocument();
    expect(screen.getByText('2 章')).toBeInTheDocument();
    expect(screen.getByText('Studio 导出')).toBeInTheDocument();
    expect(screen.getByLabelText('项目描述')).toHaveValue('给 DeepSeek 视频做旁白');
    expect(screen.getByLabelText('项目类型')).toHaveValue('explainer');
    expect(screen.getByLabelText('默认语言')).toHaveValue('zh-CN');
    expect(screen.getByLabelText('默认导出目录')).toHaveValue('public/audio');
    expect(screen.getByLabelText('导出命名模板')).toHaveValue('{project}-{chapter}-{date}');

    fireEvent.change(screen.getByLabelText('项目名称'), { target: { value: '正式项目' } });
    fireEvent.change(screen.getByLabelText('Remotion 项目路径'), { target: { value: '/Users/rio/video' } });
    fireEvent.change(screen.getByLabelText('项目描述'), { target: { value: '新版项目描述' } });
    fireEvent.change(screen.getByLabelText('项目类型'), { target: { value: 'audiobook' } });
    fireEvent.change(screen.getByLabelText('默认语言'), { target: { value: 'en-US' } });
    fireEvent.change(screen.getByLabelText('默认导出目录'), { target: { value: 'public/narration' } });
    fireEvent.change(screen.getByLabelText('导出命名模板'), { target: { value: '{chapter}-{index}' } });
    fireEvent.click(screen.getByRole('button', { name: /返回总览/ }));

    expect(onRenameProject).toHaveBeenCalledWith('正式项目');
    expect(onUpdateRemotionPath).toHaveBeenCalledWith('/Users/rio/video');
    expect(onUpdateProjectMeta).toHaveBeenCalledWith({ description: '新版项目描述' });
    expect(onUpdateProjectMeta).toHaveBeenCalledWith({ project_type: 'audiobook' });
    expect(onUpdateProjectMeta).toHaveBeenCalledWith({ default_language: 'en-US' });
    expect(onUpdateProjectMeta).toHaveBeenCalledWith({ export_directory: 'public/narration' });
    expect(onUpdateProjectMeta).toHaveBeenCalledWith({ export_naming_template: '{chapter}-{index}' });
    expect(onBackToOverview).toHaveBeenCalled();
  });
});
