import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ConflictedDraftEntry } from '../../services/conflictedDraftStore';
import { ConflictDraftsDialog } from './ConflictDraftsDialog';

function makeEntry(id: string, archivedAt: string, updatedAt: string, chapters = 2, segments = 5): ConflictedDraftEntry {
  return {
    id,
    project_id: 'p1',
    archived_at: archivedAt,
    record: {
      project_id: 'p1',
      draft: {
        schema_version: 2, id: 'p1', name: 'x', layout: 'vertical',
        chapters: Array.from({ length: chapters }, () => ({
          id: 'c', name: 'c', segments: Array.from({ length: segments }, () => ({})),
        })) as never,
        created_at: updatedAt, updated_at: updatedAt,
      },
      base_updated_at: '2026-09-23T00:00:00',
      updated_at: updatedAt,
      dirty: true,
    },
  };
}

describe('ConflictDraftsDialog（冲突草稿归档找回）', () => {
  it('open=false 不渲染', () => {
    render(<ConflictDraftsDialog open={false} entries={[]} onClose={vi.fn()} onRestore={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('列出归档条目：时间戳与章/段统计', () => {
    const entries = [
      makeEntry('e1', '2026-09-23T02:00:00', '2026-09-23T01:30:00', 2, 5),
      makeEntry('e2', '2026-09-23T03:00:00', '2026-09-23T02:30:00', 1, 3),
    ];
    render(<ConflictDraftsDialog open entries={entries} onClose={vi.fn()} onRestore={vi.fn()} onDelete={vi.fn()} />);

    const dialog = screen.getByRole('alertdialog');
    expect(screen.getByText('冲突草稿归档')).toBeInTheDocument();
    expect(dialog.textContent).toContain('2026-09-23T02:00:00');
    expect(dialog.textContent).toContain('2026-09-23T01:30:00');
    expect(screen.getByText('2 章 · 10 段')).toBeInTheDocument();
    expect(screen.getByText('1 章 · 3 段')).toBeInTheDocument();
  });

  it('恢复/删除按钮携带对应条目触发回调', () => {
    const entries = [makeEntry('e1', '2026-09-23T02:00:00', '2026-09-23T01:30:00')];
    const onRestore = vi.fn();
    const onDelete = vi.fn();
    render(<ConflictDraftsDialog open entries={entries} onClose={vi.fn()} onRestore={onRestore} onDelete={onDelete} />);

    fireEvent.click(screen.getByRole('button', { name: '恢复此草稿' }));
    expect(onRestore).toHaveBeenCalledWith(entries[0]);

    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    expect(onDelete).toHaveBeenCalledWith(entries[0]);
  });

  it('空归档显示空态文案', () => {
    render(<ConflictDraftsDialog open entries={[]} onClose={vi.fn()} onRestore={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText('当前项目没有归档的冲突草稿')).toBeInTheDocument();
  });
});
