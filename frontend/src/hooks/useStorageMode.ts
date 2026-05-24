import { createContext, useContext } from 'react';

export type StorageMode = 'backend' | 'frontend';

export const StorageModeContext = createContext<{
  mode: StorageMode;
  setMode: (mode: StorageMode) => void;
}>({
  mode: 'frontend',
  setMode: () => {},
});

/** 获取当前存储模式 */
export function useStorageMode() {
  return useContext(StorageModeContext);
}