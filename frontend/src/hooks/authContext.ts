/**
 * 认证 Context（spec 5.2c · M6）。
 *
 * 默认值对应「auth 关闭 / 未包 Provider」：user=null、isAnonymous=false ——
 * 本地开发与既有组件测试行为完全不变。
 * Provider 组件在 ./AuthProvider.tsx（react-refresh 要求组件文件只导出组件）。
 */
import { createContext, useContext } from 'react';

export interface AuthUser {
  id: string;
  email: string;
}

export interface AuthContextValue {
  /** 已登录用户；未登录（含匿名）为 null */
  user: AuthUser | null;
  /** 当前用户是否服务端管理员（以 GET /api/admin/stats/overview 403 探测） */
  isAdmin: boolean;
  /** auth 开启且未登录 —— 匿名模式：只能用 allowlist 内的无状态云端能力 */
  isAnonymous: boolean;
  /** 首次会话恢复进行中 */
  loading: boolean;
  /** 会话失效（refresh 失败）后被置 true，App 据此跳回登录页 */
  sessionExpired: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  /** 注册；返回 true 表示需要邮件验证后才能登录 */
  signUp: (email: string, password: string) => Promise<boolean>;
  signOut: () => Promise<void>;
  clearSessionExpired: () => void;
}

const notReady = () => Promise.reject(new Error('Auth is not available'));

export const AuthContext = createContext<AuthContextValue>({
  user: null,
  isAdmin: false,
  isAnonymous: false,
  loading: false,
  sessionExpired: false,
  signIn: notReady,
  signUp: notReady,
  signOut: notReady,
  clearSessionExpired: () => undefined,
});

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
