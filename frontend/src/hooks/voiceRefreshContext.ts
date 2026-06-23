import { createContext } from 'react';

export interface VoiceRefreshContextValue {
  /** 递增的计数器，消费者监听此值变化来触发刷新 */
  refreshCounter: number;
  /** 任意组件调用此方法通知所有消费者刷新 */
  triggerRefresh: () => void;
}

export const VoiceRefreshContext = createContext<VoiceRefreshContextValue>({
  refreshCounter: 0,
  triggerRefresh: () => undefined,
});
