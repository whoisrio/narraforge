import { useEffect, useState, type ReactNode } from 'react';
import { LOCAL_CAPABILITIES, fetchCapabilities, isCapabilities, type Capabilities } from '../services/capabilities';
import { CapabilitiesContext } from './useCapabilities';

/**
 * 部署能力 Provider（spec 第 4 节）：App 启动时探测一次。
 * 初始值与探测失败/畸形载荷回退均为 LOCAL_CAPABILITIES —— 本地开发体验不变。
 */
export function CapabilitiesProvider({ children }: { children: ReactNode }) {
  const [capabilities, setCapabilities] = useState<Capabilities>(LOCAL_CAPABILITIES);

  useEffect(() => {
    let cancelled = false;
    fetchCapabilities()
      .then((caps) => { if (!cancelled) setCapabilities(isCapabilities(caps) ? caps : LOCAL_CAPABILITIES); })
      .catch(() => { if (!cancelled) setCapabilities(LOCAL_CAPABILITIES); });
    return () => { cancelled = true; };
  }, []);

  return (
    <CapabilitiesContext.Provider value={capabilities}>
      {children}
    </CapabilitiesContext.Provider>
  );
}
