import { useState, useCallback } from 'react';
import { VoiceRefreshContext } from './voiceRefreshContext';

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
