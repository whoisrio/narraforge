import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { SegmentedProject } from '../../types';
import type { ProjectDraftRecord } from '../../services/segmentedDraftStore';
import { ConflictPrompt } from './ConflictPrompt';

const backend: SegmentedProject = {
  schema_version: 2, id: 'p1', name: 'backend-name', layout: 'vertical',
  chapters: [], created_at: '2026-09-23T02:00:00', updated_at: '2026-09-23T02:00:00',
};

const draft: ProjectDraftRecord = {
  project_id: 'p1',
  draft: { ...backend, name: 'draft-name', updated_at: '2026-09-23T01:30:00' },
  base_updated_at: '2026-09-23T01:00:00',
  updated_at: '2026-09-23T01:30:00',
  dirty: true,
};

describe('ConflictPrompt（模态冲突裁决）', () => {
  it('以 alertdialog 模态渲染：标题、两侧版本时间戳、归档提示', () => {
    render(<ConflictPrompt backend={backend} draft={draft} onUseBackend={vi.fn()} onUseDraft={vi.fn()} />);

    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText('检测到版本冲突')).toBeInTheDocument();
    expect(dialog.textContent).toContain('2026-09-23T02:00:00');
    expect(dialog.textContent).toContain('2026-09-23T01:30:00');
    // 归档兜底提示：被放弃的草稿可找回
    expect(screen.getByText(/冲突草稿/)).toBeInTheDocument();
  });

  it('两个裁决按钮分别触发对应回调', () => {
    const onUseDraft = vi.fn();
    const onUseBackend = vi.fn();
    render(<ConflictPrompt backend={backend} draft={draft} onUseBackend={onUseBackend} onUseDraft={onUseDraft} />);

    fireEvent.click(screen.getByRole('button', { name: '恢复本地草稿' }));
    expect(onUseDraft).toHaveBeenCalledTimes(1);
    expect(onUseBackend).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '使用后端版本' }));
    expect(onUseBackend).toHaveBeenCalledTimes(1);
  });

  it('无关闭/取消途径：点击遮罩不触发任何裁决（必须二选一）', () => {
    const onUseDraft = vi.fn();
    const onUseBackend = vi.fn();
    render(<ConflictPrompt backend={backend} draft={draft} onUseBackend={onUseBackend} onUseDraft={onUseDraft} />);

    fireEvent.click(screen.getByRole('alertdialog').parentElement!);
    expect(onUseDraft).not.toHaveBeenCalled();
    expect(onUseBackend).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });
});
