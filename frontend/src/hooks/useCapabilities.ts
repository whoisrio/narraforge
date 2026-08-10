import { createContext, useContext } from 'react';
import { LOCAL_CAPABILITIES, type Capabilities } from '../services/capabilities';

/**
 * 部署能力 Context（spec 第 4 节）。
 * 默认值与探测失败回退均为 LOCAL_CAPABILITIES —— 本地开发永远不闪隐 UI。
 * Provider 组件在 ./CapabilitiesProvider.tsx（react-refresh 要求组件文件只导出组件）。
 */
export const CapabilitiesContext = createContext<Capabilities>(LOCAL_CAPABILITIES);

export function useCapabilities(): Capabilities {
  return useContext(CapabilitiesContext);
}
