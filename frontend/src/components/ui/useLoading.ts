import { useContext } from 'react';
import { LoadingContext } from './loadingContext';

/** 访问全局加载反馈通道；Provider 外回退为直接执行（见 loadingContext）。 */
export function useLoading() {
  return useContext(LoadingContext);
}
