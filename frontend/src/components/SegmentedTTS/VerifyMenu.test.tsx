import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { VerifyMenu } from './VerifyMenu';

describe('VerifyMenu', () => {
  it('空闲：下拉含「核对本章」与「全量核对」', () => {
    render(<VerifyMenu onSelect={vi.fn()} />);
    expect(screen.queryByText('核对本章')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /语音核对/ }));
    expect(screen.getByText('核对本章')).toBeInTheDocument();
    expect(screen.getByText('全量核对（项目所有章节）')).toBeInTheDocument();
  });

  it('选择核对本章 → onSelect({kind: chapter})', () => {
    const onSelect = vi.fn();
    render(<VerifyMenu onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: /语音核对/ }));
    fireEvent.click(screen.getByText('核对本章'));
    expect(onSelect).toHaveBeenCalledWith({ kind: 'chapter' });
  });

  it('活跃 run：pill「核对中 3/28」+ 可取消；下拉不渲染（禁用入口）', () => {
    const onSelect = vi.fn();
    const onCancel = vi.fn();
    render(<VerifyMenu onSelect={onSelect} running={{ done: 3, total: 28, snapshot: false }} onCancel={onCancel} />);
    expect(screen.getByTestId('verify-run-pill')).toBeInTheDocument();
    expect(screen.getByText('核对中 3/28')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /语音核对/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(onCancel).toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('快照 run：显示进度但不提供取消（跨 tab 无控制权）', () => {
    render(<VerifyMenu onSelect={vi.fn()} running={{ done: 3, total: 28, snapshot: true }} onCancel={vi.fn()} />);
    expect(screen.getByText('核对中 3/28')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '取消' })).not.toBeInTheDocument();
  });

  it('中断 run：提示 + 续跑', () => {
    const onResume = vi.fn();
    render(<VerifyMenu onSelect={vi.fn()} interrupted={{ done: 12, total: 28 }} onResume={onResume} />);
    expect(screen.getByText('上次核对中断于 12/28')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '续跑' }));
    expect(onResume).toHaveBeenCalled();
  });
});
