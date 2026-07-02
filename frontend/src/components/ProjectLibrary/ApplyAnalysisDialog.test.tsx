import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApplyAnalysisDialog } from './ApplyAnalysisDialog';
import type { TextAnalysisSplitResult } from '../../services/api';

function makeResult(chapters = 2, roleNames: string[] = ['小明', '小红']): TextAnalysisSplitResult {
  return {
    method: 'regex',
    chapters: Array.from({ length: chapters }, (_, i) => ({
      title: `第${i + 1}章`,
      segments: [],
    })),
    detected_roles: roleNames.map((name, i) => ({
      name,
      occurrences: i + 3,
      confidence: 0.9,
    })),
  };
}

describe('ApplyAnalysisDialog', () => {
  it('renders default confirmation when no conflicts', () => {
    render(
      <ApplyAnalysisDialog
        conflict={{ existingChapters: 0, existingRoles: 0, newChapters: 2, newRoles: [{ name: '小明' }, { name: '小红' }] }}
        result={makeResult()}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.getByText('应用分析结果')).toBeInTheDocument();
    expect(screen.getByText(/识别出 2 个章节、2 个角色/)).toBeInTheDocument();
    expect(screen.getByText('确认应用')).toBeInTheDocument();
  });

  it('warns about full overwrite when both chapters and roles exist', () => {
    render(
      <ApplyAnalysisDialog
        conflict={{ existingChapters: 3, existingRoles: 4, newChapters: 2, newRoles: [{ name: '小明' }, { name: '小红' }] }}
        result={makeResult()}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.getByText('覆盖已有内容？')).toBeInTheDocument();
    expect(screen.getByText(/已有 3 个章节和 4 个角色/)).toBeInTheDocument();
    expect(screen.getByText(/删除全部已有章节/)).toBeInTheDocument();
    expect(screen.getByText(/覆盖同名角色，保留其余角色/)).toBeInTheDocument();
    expect(screen.getByText('确认覆盖')).toBeInTheDocument();
  });

  it('warns about chapter overwrite (chapters only)', () => {
    render(
      <ApplyAnalysisDialog
        conflict={{ existingChapters: 2, existingRoles: 0, newChapters: 3, newRoles: [{ name: '小明' }] }}
        result={makeResult(3, ['小明'])}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.getByText('覆盖已有章节？')).toBeInTheDocument();
    expect(screen.getByText(/已有 2 个章节/)).toBeInTheDocument();
    expect(screen.getByText('确认覆盖')).toBeInTheDocument();
  });

  it('warns about role merge (roles only, no chapter conflict)', () => {
    render(
      <ApplyAnalysisDialog
        conflict={{ existingChapters: 0, existingRoles: 3, newChapters: 2, newRoles: [{ name: '小明' }, { name: '小红' }] }}
        result={makeResult()}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.getByText('覆盖同名角色？')).toBeInTheDocument();
    expect(screen.getByText(/其中与分析结果同名的将被替换/)).toBeInTheDocument();
    expect(screen.getByText(/保留其余角色，追加新角色/)).toBeInTheDocument();
    expect(screen.getByText('确认应用')).toBeInTheDocument();
  });

  it('shows role tags', () => {
    render(
      <ApplyAnalysisDialog
        conflict={{ existingChapters: 0, existingRoles: 0, newChapters: 1, newRoles: [{ name: '小明' }, { name: '小红' }] }}
        result={makeResult(1, ['小明', '小红'])}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.getByText('小明')).toBeInTheDocument();
    expect(screen.getByText('小红')).toBeInTheDocument();
  });

  it('hides role tags when no roles detected', () => {
    render(
      <ApplyAnalysisDialog
        conflict={{ existingChapters: 0, existingRoles: 0, newChapters: 2, newRoles: [] }}
        result={makeResult(2, [])}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.queryByText('小明')).not.toBeInTheDocument();
  });

  it('calls onCancel when cancel button clicked', () => {
    const onCancel = vi.fn();
    render(
      <ApplyAnalysisDialog
        conflict={{ existingChapters: 0, existingRoles: 0, newChapters: 1, newRoles: [] }}
        result={makeResult(1, [])}
        onCancel={onCancel}
        onConfirm={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText('取消'));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('calls onConfirm when confirm button clicked', () => {
    const onConfirm = vi.fn();
    render(
      <ApplyAnalysisDialog
        conflict={{ existingChapters: 0, existingRoles: 0, newChapters: 1, newRoles: [] }}
        result={makeResult(1, [])}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    fireEvent.click(screen.getByText('确认应用'));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('calls onCancel when clicking overlay backdrop', () => {
    const onCancel = vi.fn();
    render(
      <ApplyAnalysisDialog
        conflict={{ existingChapters: 0, existingRoles: 0, newChapters: 1, newRoles: [] }}
        result={makeResult(1, [])}
        onCancel={onCancel}
        onConfirm={vi.fn()}
      />,
    );

    // Click the overlay (the outer div)
    const overlay = screen.getByText('应用分析结果').closest('[class*="overlay"]');
    if (overlay) fireEvent.click(overlay);
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
