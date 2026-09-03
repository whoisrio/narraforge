import { useRef, useState } from 'react';
import { act, render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { LoadingProvider } from './LoadingProvider';
import { useLoading } from './useLoading';

function RetryHarness() {
  const { run } = useLoading();
  const [result, setResult] = useState('idle');
  const [attempts, setAttempts] = useState(0);
  const [firstSignalAborted, setFirstSignalAborted] = useState('unknown');
  const firstSignalRef = useRef<AbortSignal | null>(null);
  const attemptsRef = useRef(0);
  return (
    <>
      <div data-testid="result">{result}</div>
      <div data-testid="attempts">{attempts}</div>
      <div data-testid="first-aborted">{firstSignalAborted}</div>
      <button onClick={() => {
        void run('可重试任务…', async (ctx) => {
          attemptsRef.current += 1;
          const n = attemptsRef.current;
          setAttempts(n);
          if (n === 1) firstSignalRef.current = ctx.signal;
          else setFirstSignalAborted(String(firstSignalRef.current?.aborted ?? 'unknown'));
          // 模拟 axios：监听 signal，abort 时 reject；第二次 attempt 100ms 即完成
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(resolve, n === 1 ? 40000 : 100);
            ctx.signal.addEventListener('abort', () => {
              clearTimeout(timer);
              reject(ctx.signal.reason);
            });
          });
          return `done-at-${n}`;
        }, { retryable: true }).then((v) => setResult(v));
      }}>start-retry</button>
      <button onClick={() => {
        void run('不可重试任务…', async () => {
          await new Promise((resolve) => setTimeout(resolve, 35000));
          return 'plain-done';
        }).then((v) => setResult(v));
      }}>start-plain</button>
    </>
  );
}

function renderRetryApp() {
  return render(
    <LoadingProvider>
      <RetryHarness />
    </LoadingProvider>,
  );
}

function Harness() {
  const { run } = useLoading();
  const [result, setResult] = useState('idle');
  return (
    <>
      <div data-testid="result">{result}</div>
      <button onClick={() => {
        void run('正在加载测试数据…', async () => {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          return 'done';
        }).then((v) => setResult(v));
      }}>start</button>
      <button onClick={() => {
        void run('快速任务…', async () => {
          await new Promise((resolve) => setTimeout(resolve, 50));
          return 'fast-done';
        }).then((v) => setResult(v));
      }}>start-fast</button>
      <button onClick={() => {
        void run('出错任务…', async () => {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          throw new Error('boom');
        }).catch((e: Error) => setResult(`error:${e.message}`));
      }}>start-error</button>
      <button onClick={() => {
        void run('外层任务…', async () => {
          await new Promise((resolve) => setTimeout(resolve, 2000));
          const inner = await run('内层任务…', async () => {
            await new Promise((resolve) => setTimeout(resolve, 1000));
            return 'inner-done';
          });
          await new Promise((resolve) => setTimeout(resolve, 500));
          return `outer:${inner}`;
        }).then((v) => setResult(v));
      }}>start-nested</button>
      <button onClick={() => {
        void run('慢任务…', async () => {
          await new Promise((resolve) => setTimeout(resolve, 15000));
          return 'slow-done';
        }).then((v) => setResult(v));
      }}>start-slow</button>
    </>
  );
}

function renderApp() {
  return render(
    <LoadingProvider>
      <Harness />
    </LoadingProvider>,
  );
}

describe('LoadingProvider', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('run() 任务进行中显示阻断模态，完成后关闭并返回结果', async () => {
    renderApp();
    fireEvent.click(screen.getByText('start'));
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(screen.getByRole('dialog')).toHaveTextContent('正在加载测试数据…');
    await act(async () => { await vi.advanceTimersByTimeAsync(800); });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByTestId('result')).toHaveTextContent('done');
  });

  it('快速完成的任务（默认 250ms 阈值内）不闪模态', async () => {
    renderApp();
    fireEvent.click(screen.getByText('start-fast'));
    // 任务进行中（50ms 未到）但延迟阈值（250ms）未到：模态不应出现
    await act(async () => { await vi.advanceTimersByTimeAsync(25); });
    expect(screen.queryByRole('dialog')).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByTestId('result')).toHaveTextContent('fast-done');
  });

  it('任务抛错时原样 rethrow 并关闭模态', async () => {
    renderApp();
    fireEvent.click(screen.getByText('start-error'));
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(screen.getByRole('dialog')).toHaveTextContent('出错任务…');
    await act(async () => { await vi.advanceTimersByTimeAsync(800); });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByTestId('result')).toHaveTextContent('error:boom');
  });

  it('嵌套 run：内层文案替换栈顶，内层完成后回到外层，模态全程不消失', async () => {
    renderApp();
    fireEvent.click(screen.getByText('start-nested'));
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(screen.getByRole('dialog')).toHaveTextContent('外层任务…');
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(screen.getByRole('dialog')).toHaveTextContent('内层任务…');
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(screen.getByRole('dialog')).toHaveTextContent('外层任务…');
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByTestId('result')).toHaveTextContent('outer:inner-done');
  });

  it('慢任务 10 秒后显示安抚提示与已等待秒数，并随时间刷新', async () => {
    renderApp();
    fireEvent.click(screen.getByText('start-slow'));
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(screen.getByRole('dialog')).toHaveTextContent('慢任务…');
    expect(screen.getByRole('dialog')).not.toHaveTextContent('耗时较长');
    await act(async () => { await vi.advanceTimersByTimeAsync(10700); }); // t≈11000
    expect(screen.getByRole('dialog')).toHaveTextContent('耗时较长');
    expect(screen.getByRole('dialog')).toHaveTextContent('已等待 10 秒');
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); }); // t≈12000
    expect(screen.getByRole('dialog')).toHaveTextContent('已等待 11 秒');
    await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByTestId('result')).toHaveTextContent('slow-done');
  });

  it('模态可见时背景容器 inert 阻断交互，关闭后解除', async () => {
    const { container } = renderApp();
    const background = container.firstElementChild as HTMLElement;
    expect(background.hasAttribute('inert')).toBe(false);
    fireEvent.click(screen.getByText('start'));
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(background.hasAttribute('inert')).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(800); });
    expect(background.hasAttribute('inert')).toBe(false);
  });

  it('retryable 任务 30 秒后出现重试按钮，点击后中断重跑并返回重试结果', async () => {
    renderRetryApp();
    fireEvent.click(screen.getByText('start-retry'));
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(screen.queryByRole('button', { name: '重试' })).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(29700); }); // t≈30000，最近 tick 29250，未到阈值
    expect(screen.queryByRole('button', { name: '重试' })).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(500); }); // t≈30500，tick 30250 已过阈值
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(screen.getByTestId('attempts')).toHaveTextContent('2');
    expect(screen.getByTestId('first-aborted')).toHaveTextContent('true');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByTestId('result')).toHaveTextContent('done-at-2');
  });

  it('非 retryable 任务即使超过 30 秒也不出现重试按钮', async () => {
    renderRetryApp();
    fireEvent.click(screen.getByText('start-plain'));
    await act(async () => { await vi.advanceTimersByTimeAsync(31000); });
    expect(screen.queryByRole('button', { name: '重试' })).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(screen.getByTestId('result')).toHaveTextContent('plain-done');
  });
});
