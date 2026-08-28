import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { SegmentedProject } from '../../types';
import { SegmentSearchBar } from './SegmentSearchBar';

function makeProject(): SegmentedProject {
  const voice = { engine: 'edge_tts' as const, voice: '', rate: '+0%', volume: '+0%' };
  const seg = (id: string, text: string, position: number) => ({
    id, text, position, voice: { source: 'chapter' as const }, status: 'idle' as const,
    audio: { format: 'mp3' }, segment_kind: 'narration' as const, created_at: 'x', updated_at: 'x',
  });
  return {
    schema_version: 2, id: 'p', name: 'P', layout: 'vertical',
    active_chapter_id: 'c1', created_at: 'x', updated_at: 'x',
    chapters: [
      { id: 'c1', name: '夜路', voice, split_config: { delimiters: ['。'], mode: 'rule' }, created_at: 'x', updated_at: 'x',
        segments: [seg('s1', '夜色渐浓。', 0)] },
      { id: 'c2', name: '破庙', voice, split_config: { delimiters: ['。'], mode: 'rule' }, created_at: 'x', updated_at: 'x',
        segments: [seg('s2', '破庙里透出人声。', 0), seg('s3', '调用 REST API 接口。', 1)] },
    ],
  };
}

function renderBar(overrides: Partial<Parameters<typeof SegmentSearchBar>[0]> = {}) {
  const onNavigate = vi.fn();
  const onSetSegmentLowercase = vi.fn();
  render(
    <SegmentSearchBar
      project={makeProject()}
      onNavigate={onNavigate}
      onSetSegmentLowercase={onSetSegmentLowercase}
      projectLowercaseLatin={false}
      {...overrides}
    />,
  );
  return { onNavigate, onSetSegmentLowercase };
}

describe('SegmentSearchBar', () => {
  it('输入即搜，跨章节列出命中并显示总命中数', () => {
    renderBar();
    fireEvent.change(screen.getByLabelText('搜索全项目片段'), { target: { value: '人' } });
    expect(screen.getByRole('listbox', { name: '搜索结果' })).toBeTruthy();
    expect(screen.getByText('1 处命中')).toBeTruthy();
    expect(screen.getByText(/破庙里透出/)).toBeTruthy();
  });

  it('点击结果回调 onNavigate 并关闭面板', () => {
    const { onNavigate } = renderBar();
    fireEvent.change(screen.getByLabelText('搜索全项目片段'), { target: { value: '人声' } });
    fireEvent.click(screen.getByRole('option', { name: /破庙里透出/ }));
    expect(onNavigate).toHaveBeenCalledWith(expect.objectContaining({ chapterId: 'c2', segmentId: 's2' }));
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('键盘 ↓/↑ 移动、Enter 跳转、Esc 关闭', () => {
    const { onNavigate } = renderBar();
    const input = screen.getByLabelText('搜索全项目片段');
    fireEvent.change(input, { target: { value: '调用' } });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onNavigate).toHaveBeenCalledWith(expect.objectContaining({ segmentId: 's3' }));
  });

  it('「含全大写词」过滤器列出大写词段，带小写三态开关', () => {
    const { onSetSegmentLowercase } = renderBar();
    fireEvent.click(screen.getByRole('button', { name: '含全大写词' }));
    // 高亮把 snippet 拆成 mark/span 片段，getByText 匹配不到跨元素文本，
    // 改用 option 的可访问名（aria-label=完整 snippet）断言
    expect(screen.getByRole('option', { name: /REST API/ })).toBeTruthy();
    expect(screen.queryByText(/夜色渐浓/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '小写', exact: true }));
    expect(onSetSegmentLowercase).toHaveBeenCalledWith('s3', true);
  });

  it('段级覆盖已设时三态显示当前值', () => {
    const p = makeProject();
    p.chapters[1].segments[1].text_transforms = { lowercase_latin: false };
    renderBar({ project: p });
    fireEvent.click(screen.getByRole('button', { name: '含全大写词' }));
    const keepBtn = screen.getByRole('button', { name: '保持大写' });
    expect(keepBtn.getAttribute('aria-pressed')).toBe('true');
  });
});
