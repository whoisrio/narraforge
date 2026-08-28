import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { PronunciationMapEntry, SegmentedProject } from '../../types';
import { PronunciationMapPanel } from './PronunciationMapPanel';

function makeProject(configs?: SegmentedProject['configs']): SegmentedProject {
  const voice = { engine: 'edge_tts' as const, voice: '', rate: '+0%', volume: '+0%' };
  const seg = (id: string, text: string, position: number, text_transforms?: { applied_map_ids?: string[] }) => ({
    id, text, position, voice: { source: 'chapter' as const }, status: 'idle' as const,
    audio: { format: 'mp3' }, segment_kind: 'narration' as const,
    text_transforms, created_at: 'x', updated_at: 'x',
  });
  return {
    schema_version: 2, id: 'p', name: 'P', layout: 'vertical',
    active_chapter_id: 'c1', created_at: 'x', updated_at: 'x', configs,
    chapters: [
      { id: 'c1', name: '夜路', voice, split_config: { delimiters: ['。'], mode: 'rule' }, created_at: 'x', updated_at: 'x',
        segments: [seg('s1', '他调动了队伍。', 0)] },
      { id: 'c2', name: '破庙', voice, split_config: { delimiters: ['。'], mode: 'rule' }, created_at: 'x', updated_at: 'x',
        segments: [seg('s2', '再次调动人马。', 0, { applied_map_ids: ['pm_exist'] })] },
    ],
  };
}

const GLOBAL_MAP: PronunciationMapEntry[] = [
  { id: 'gpm_1', source: '行长', target: '行长(读háng)' },
];

function renderPanel(overrides: Partial<React.ComponentProps<typeof PronunciationMapPanel>> = {}) {
  const onUpdateProjectMeta = vi.fn();
  const onSetSegmentTransforms = vi.fn();
  render(
    <PronunciationMapPanel
      open
      project={makeProject()}
      globalMap={GLOBAL_MAP}
      onClose={() => {}}
      onUpdateProjectMeta={onUpdateProjectMeta}
      onSetSegmentTransforms={onSetSegmentTransforms}
      {...overrides}
    />,
  );
  return { onUpdateProjectMeta, onSetSegmentTransforms };
}

describe('PronunciationMapPanel', () => {
  it('全局条目只读展示（带「全局」徽标，无删除按钮）', () => {
    renderPanel();
    expect(screen.getByText('全局')).toBeTruthy();
    expect(screen.getByText(/行长 ->/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: '删除映射' })).toBeNull();
  });

  it('新增项目映射：校验后回调 onUpdateProjectMeta', () => {
    const { onUpdateProjectMeta } = renderPanel();
    fireEvent.change(screen.getByLabelText('映射原文'), { target: { value: '调动' } });
    fireEvent.change(screen.getByLabelText('替换为'), { target: { value: '掉动' } });
    fireEvent.click(screen.getByRole('button', { name: '添加映射' }));
    expect(onUpdateProjectMeta).toHaveBeenCalledWith({
      pronunciation_map: [expect.objectContaining({ source: '调动', target: '掉动', id: expect.stringMatching(/^pm_/) })],
    });
  });

  it('原文为空或与项目字典重复时给出错误提示且不回调', () => {
    const { onUpdateProjectMeta } = renderPanel({
      project: makeProject({ pronunciation_map: [{ id: 'pm_1', source: '调动', target: '掉动' }] }),
    });
    fireEvent.change(screen.getByLabelText('映射原文'), { target: { value: '调动' } });
    fireEvent.click(screen.getByRole('button', { name: '添加映射' }));
    expect(screen.getByRole('alert').textContent).toContain('唯一');
    expect(onUpdateProjectMeta).not.toHaveBeenCalled();
  });

  it('选中映射后列出全项目命中段，含替换后效果预览', () => {
    renderPanel({ project: makeProject({ pronunciation_map: [{ id: 'pm_1', source: '调动', target: '掉动' }] }) });
    fireEvent.click(screen.getByRole('button', { name: /调动 -> 掉动/ }));
    expect(screen.getByText('2 个命中段')).toBeTruthy();
    expect(screen.getByText('他掉动了队伍。')).toBeTruthy();
    expect(screen.getByText('再次掉动人马。')).toBeTruthy();
  });

  it('勾选命中段写回 applied_map_ids（保留已有引用）', () => {
    const { onSetSegmentTransforms } = renderPanel({
      project: makeProject({ pronunciation_map: [{ id: 'pm_1', source: '调动', target: '掉动' }] }),
    });
    fireEvent.click(screen.getByRole('button', { name: /调动 -> 掉动/ }));
    const boxes = screen.getAllByLabelText('应用到该段');
    fireEvent.click(boxes[1]);  // s2 已引用 pm_exist
    expect(onSetSegmentTransforms).toHaveBeenCalledWith('s2', { applied_map_ids: ['pm_exist', 'pm_1'] });
  });

  it('删除被引用映射：确认后清理引用并更新项目字典', () => {
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
    const { onUpdateProjectMeta, onSetSegmentTransforms } = renderPanel({
      project: makeProject({ pronunciation_map: [{ id: 'pm_exist', source: '调动', target: '掉动' }] }),
    });
    const deleteButtons = screen.getAllByRole('button', { name: '删除映射' });
    fireEvent.click(deleteButtons[0]);
    expect(window.confirm).toHaveBeenCalled();
    expect(onSetSegmentTransforms).toHaveBeenCalledWith('s2', { applied_map_ids: [] });
    expect(onUpdateProjectMeta).toHaveBeenCalledWith({ pronunciation_map: [] });
    vi.unstubAllGlobals();
  });

  it('pronunciation_apply_all 开启时勾选列表置灰并提示', () => {
    renderPanel({
      project: makeProject({
        pronunciation_map: [{ id: 'pm_1', source: '调动', target: '掉动' }],
        pronunciation_apply_all: true,
      }),
    });
    fireEvent.click(screen.getByRole('button', { name: /调动 -> 掉动/ }));
    expect(screen.getByText(/全量应用发音映射/)).toBeTruthy();
    expect((screen.getAllByLabelText('应用到该段')[0] as HTMLInputElement).disabled).toBe(true);
  });
});
