import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { isAuthRequired, setUnauthorizedHandler } from '../services/auth';
import * as authSession from '../services/authSession';
import { adminApi } from '../services/adminApi';
import { AuthContext, type AuthContextValue, type AuthUser } from './authContext';

function toAuthUser(user: { id: string; email?: string } | null): AuthUser | null {
  if (!user) return null;
  return { id: user.id, email: user.email ?? '' };
}

/**
 * Supabase Auth Provider（spec 5.2c · M6）。
 * 仅 auth 开启时挂载（App 顶层按 isAuthRequired() 分支）：
 * 启动时恢复持久化会话 → 订阅会话变化 → 登录后以 403 探测是否管理员。
 * 会话彻底失效（refresh 失败）时由 auth.ts 的 unauthorized 回调驱动 sessionExpired。
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [adminUserId, setAdminUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionExpired, setSessionExpired] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    try {
      unsubscribe = authSession.onAuthStateChange((session) => {
        if (!cancelled) setUser(toAuthUser(session?.user ?? null));
      });
    } catch {
      // Supabase 未配置：保持匿名，拦截器同样退化为无 token
    }
    authSession.getSession()
      .then((session) => { if (!cancelled) setUser(toAuthUser(session?.user ?? null)); })
      .catch(() => { if (!cancelled) setUser(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    setUnauthorizedHandler(() => {
      if (!cancelled) {
        setUser(null);
        setSessionExpired(true);
      }
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
      setUnauthorizedHandler(null);
    };
  }, []);

  // 登录态变化后探测管理员身份：403 admin_required → 非管理员。
  // isAdmin 由 adminUserId 派生，避免在 effect 里同步 setState（react-hooks/set-state-in-effect）。
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    adminApi.getOverview()
      .then(() => { if (!cancelled) setAdminUserId(user.id); })
      .catch(() => { if (!cancelled) setAdminUserId(null); });
    return () => { cancelled = true; };
  }, [user]);
  const isAdmin = !!user && adminUserId === user.id;

  const signIn = useCallback(async (email: string, password: string) => {
    const session = await authSession.signIn(email, password);
    setUser(toAuthUser(session?.user ?? null));
    setSessionExpired(false);
  }, []);

  const signUp = useCallback(async (email: string, password: string) => {
    const session = await authSession.signUp(email, password);
    // 开启邮箱验证时注册后不返回会话 —— 需要用户验证后再登录
    setUser(toAuthUser(session?.user ?? null));
    return !session;
  }, []);

  const signOut = useCallback(async () => {
    await authSession.signOut();
    setUser(null);
  }, []);

  const clearSessionExpired = useCallback(() => setSessionExpired(false), []);

  const value = useMemo<AuthContextValue>(() => ({
    user,
    isAdmin,
    isAnonymous: isAuthRequired() && !user,
    loading,
    sessionExpired,
    signIn,
    signUp,
    signOut,
    clearSessionExpired,
  }), [user, isAdmin, loading, sessionExpired, signIn, signUp, signOut, clearSessionExpired]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
