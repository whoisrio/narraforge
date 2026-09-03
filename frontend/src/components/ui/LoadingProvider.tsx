import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { LoadingContext, type LoadingApi, type LoadingRunCtx, type LoadingRunOpts } from './loadingContext';
import { LoadingModal } from './LoadingModal';
import styles from './LoadingProvider.module.css';

interface LoadingTask {
  id: number;
  message: string;
  startedAt: number;
  retryable: boolean;
  controller: AbortController;
  retryRequested: boolean;
}

const DEFAULT_DELAY_MS = 250;

let _idCounter = 0;

/**
 * 全局加载反馈（模态阻断）。
 *
 * 用户主动触发、UI 强依赖的读操作用 run() 包裹：任务栈非空时渲染不可关闭的
 * 阻断模态（portal 到 body），显示栈顶任务的 message。后台静默请求不经过
 * 此通道——它们绝不能弹模态。
 *
 * 出现延迟：栈从空到非空时启动 delayMs（默认 250ms）计时，到点仍在飞行才
 * 显示模态——快速完成的操作（本地 IndexedDB）永不闪模态。栈非空期间嵌套
 * 任务不重新计时，模态不消失。
 */
export function LoadingProvider({ children }: { children: ReactNode }) {
  const [tasks, setTasks] = useState<LoadingTask[]>([]);
  const [visible, setVisible] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const tasksRef = useRef<LoadingTask[]>([]);
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (showTimerRef.current !== null) clearTimeout(showTimerRef.current);
  }, []);

  const run = useCallback(
    async <T,>(message: string, fn: (ctx: LoadingRunCtx) => Promise<T>, opts?: LoadingRunOpts): Promise<T> => {
      const id = ++_idCounter;
      const task: LoadingTask = {
        id,
        message,
        startedAt: Date.now(),
        retryable: opts?.retryable ?? false,
        controller: new AbortController(),
        retryRequested: false,
      };
      const wasEmpty = tasksRef.current.length === 0;
      tasksRef.current = [...tasksRef.current, task];
      setTasks(tasksRef.current);
      if (wasEmpty) {
        showTimerRef.current = setTimeout(() => {
          showTimerRef.current = null;
          setVisible(true);
        }, opts?.delayMs ?? DEFAULT_DELAY_MS);
      }
      try {
        for (;;) {
          try {
            return await fn({ signal: task.controller.signal });
          } catch (err) {
            // 重试：仅当用户主动点了重试按钮（retryRequested）才中断重跑，
            // 其它错误（含未经重试按钮的 abort）原样上抛。
            if (task.retryRequested) {
              task.retryRequested = false;
              task.controller = new AbortController();
              task.startedAt = Date.now();
              setTasks([...tasksRef.current]);
              setNow(Date.now());
              continue;
            }
            throw err;
          }
        }
      } finally {
        tasksRef.current = tasksRef.current.filter(t => t.id !== id);
        setTasks(tasksRef.current);
        if (tasksRef.current.length === 0) {
          if (showTimerRef.current !== null) {
            clearTimeout(showTimerRef.current);
            showTimerRef.current = null;
          }
          setVisible(false);
        }
      }
    },
    [],
  );

  /** 仅栈顶的可重试任务可触发重试：置标志并 abort 当前 controller。 */
  const retryTask = useCallback((taskId: number) => {
    const top = tasksRef.current[tasksRef.current.length - 1];
    if (!top || top.id !== taskId || !top.retryable) return;
    top.retryRequested = true;
    top.controller.abort();
  }, []);

  const api: LoadingApi = { run };

  const top = tasks[tasks.length - 1];

  // 模态可见期间每秒刷新一次时钟，驱动"已等待 Ns"与安抚文案。
  useEffect(() => {
    if (!visible) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [visible]);

  const elapsedMs = visible && top ? now - top.startedAt : 0;

  return (
    <LoadingContext.Provider value={api}>
      {/* display:contents：布局零侵入的背景包裹层，仅用于在模态可见时
          挂 inert（阻断后台交互与键盘焦点；模态本身 portal 在 body，不受影响） */}
      <div className={styles.background} inert={visible}>
        {children}
      </div>
      {visible && top && (
        <LoadingModal
          message={top.message}
          elapsedMs={elapsedMs}
          retryable={top.retryable}
          onRetry={() => retryTask(top.id)}
        />
      )}
    </LoadingContext.Provider>
  );
}
