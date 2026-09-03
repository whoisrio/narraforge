import { createContext } from 'react';

export interface LoadingRunCtx {
  signal: AbortSignal;
}

export interface LoadingRunOpts {
  /** 模态延迟出现阈值（ms）。快速完成的操作不应闪模态。 */
  delayMs?: number;
  /** 是否在长时间无响应时提供"重试"按钮；仅幂等读操作开启。 */
  retryable?: boolean;
}

export interface LoadingApi {
  /** 以阻断模态包裹一个异步任务：进行中显示 message，结束（成功或失败）后关闭。 */
  run: <T>(message: string, fn: (ctx: LoadingRunCtx) => Promise<T>, opts?: LoadingRunOpts) => Promise<T>;
}

const NOOP_LOADING: LoadingApi = {
  // Provider 外（隔离测试）回退为直接执行，与 ToastContext 的 NOOP 惯例一致。
  run: (_message, fn) => fn({ signal: new AbortController().signal }),
};

export const LoadingContext = createContext<LoadingApi>(NOOP_LOADING);
