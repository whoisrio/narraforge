import { createContext, useContext, useState, useCallback } from 'react';

interface VoiceRefreshContextValue {
  /** 递增的计数器，消费者监听此值变化来触发刷新 */
  refreshCounter: number;
  /** 任意组件调用此方法通知所有消费者刷新 */
  triggerRefresh: () => void;
}

const VoiceRefreshContext = createContext<VoiceRefreshContextValue>({
  refreshCounter: 0,
  triggerRefresh: () => {},
});

/** 跨组件声音数据刷新上下文：clone/delete/update description 后通知所有消费者重新拉取 */
export function VoiceRefreshProvider({ children }: { children: React.ReactNode }) {
  const [refreshCounter, setRefreshCounter] = useState(0);
  const triggerRefresh = useCallback(() => {
    setRefreshCounter((c) => c + 1);
  }, []);

  return (
    <VoiceRefreshContext.Provider value={{ refreshCounter, triggerRefresh }}>
      {children}
    </VoiceRefreshContext.Provider>
  );
}

export function useVoiceRefresh() {
  return useContext(VoiceRefreshContext);
}