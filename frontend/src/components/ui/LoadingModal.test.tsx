import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LoadingModal } from './LoadingModal';

afterEach(cleanup);

describe('LoadingModal', () => {
  it('渲染文案与无障碍属性 (role=dialog / aria-modal / aria-busy)', () => {
    render(<LoadingModal message="正在打开项目 test…" elapsedMs={0} retryable={false} onRetry={vi.fn()} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-busy', 'true');
    expect(dialog).toHaveTextContent('正在打开项目 test…');
  });

  it('elapsedMs >= 10s 显示安抚文案与已等待秒数', () => {
    render(<LoadingModal message="正在打开项目 test…" elapsedMs={10000} retryable={false} onRetry={vi.fn()} />);
    expect(screen.getByText(/耗时较长/)).toBeInTheDocument();
    expect(screen.getByText(/已等待 10 秒/)).toBeInTheDocument();
  });

  it('elapsedMs < 10s 不显示安抚文案', () => {
    render(<LoadingModal message="m" elapsedMs={9000} retryable={false} onRetry={vi.fn()} />);
    expect(screen.queryByText('耗时较长')).toBeNull();
  });

  it('retryable 且 elapsedMs >= 30s 才显示重试按钮，点击触发 onRetry', () => {
    const onRetry = vi.fn();
    render(<LoadingModal message="m" elapsedMs={30000} retryable onRetry={onRetry} />);
    const btn = screen.getByRole('button', { name: '重试' });
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('非 retryable 即使 elapsedMs >= 30s 也不显示重试按钮', () => {
    render(<LoadingModal message="m" elapsedMs={30000} retryable={false} onRetry={vi.fn()} />);
    expect(screen.queryByRole('button', { name: '重试' })).toBeNull();
  });
});
