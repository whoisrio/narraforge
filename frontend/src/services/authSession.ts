/**
 * Supabase Auth 会话封装（spec 5.2c：邮箱+密码登录，JWT Bearer 注入）。
 *
 * 懒加载单例：只在 `VITE_AUTH_REQUIRED=true` 且配置了
 * `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` 时创建 client；
 * 本地开发（auth 关闭）永不触碰 Supabase，行为与历史完全一致。
 *
 * session 由 supabase-js 持久化在 localStorage，并在此模块额外缓存一份，
 * 供 axios 同步/异步拦截器读取 access_token。
 */
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;
let cachedSession: Session | null = null;

function authEnabled(): boolean {
  return import.meta.env.VITE_AUTH_REQUIRED === 'true';
}

export function isAuthConfigured(): boolean {
  return Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
}

/** 懒加载 Supabase client 单例；auth 关闭或缺少配置时抛出明确错误。 */
export function getSupabase(): SupabaseClient {
  if (!authEnabled()) {
    throw new Error('Supabase auth is disabled (VITE_AUTH_REQUIRED is not "true")');
  }
  if (!isAuthConfigured()) {
    throw new Error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY for Supabase Auth');
  }
  if (!client) {
    client = createClient(
      import.meta.env.VITE_SUPABASE_URL as string,
      import.meta.env.VITE_SUPABASE_ANON_KEY as string,
    );
    client.auth.onAuthStateChange((_event, session) => {
      cachedSession = session;
    });
  }
  return client;
}

/** 读取当前会话（并刷新本地缓存）；auth 关闭或未配置时返回 null。 */
export async function getSession(): Promise<Session | null> {
  if (!authEnabled() || !isAuthConfigured()) return null;
  const { data } = await getSupabase().auth.getSession();
  cachedSession = data.session;
  return cachedSession;
}

/** 供 axios 请求拦截器使用：优先缓存，未缓存时拉取一次会话。 */
export async function getAccessToken(): Promise<string | null> {
  if (!authEnabled() || !isAuthConfigured()) return null;
  if (cachedSession) return cachedSession.access_token;
  const session = await getSession();
  return session?.access_token ?? null;
}

/** 401 时尝试刷新一次会话；成功返回新 access_token，失败返回 null。 */
export async function refreshSession(): Promise<string | null> {
  if (!authEnabled() || !isAuthConfigured()) return null;
  try {
    const { data, error } = await getSupabase().auth.refreshSession();
    if (error) return null;
    cachedSession = data.session;
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

export async function signIn(email: string, password: string): Promise<Session | null> {
  const { data, error } = await getSupabase().auth.signInWithPassword({ email, password });
  if (error) throw error;
  cachedSession = data.session;
  return data.session;
}

export async function signUp(email: string, password: string): Promise<Session | null> {
  const { data, error } = await getSupabase().auth.signUp({ email, password });
  if (error) throw error;
  cachedSession = data.session;
  return data.session;
}

export async function signOut(): Promise<void> {
  cachedSession = null;
  if (!client) return;
  await client.auth.signOut();
}

/** 本地登出（会话已失效时清缓存并通知 Supabase 清理本地持久化）。 */
export function signOutLocal(): void {
  cachedSession = null;
  void client?.auth.signOut().catch(() => undefined);
}

/** 订阅会话变化（登录/登出/刷新）；返回退订函数。 */
export function onAuthStateChange(callback: (session: Session | null) => void): () => void {
  const { data } = getSupabase().auth.onAuthStateChange((event, session) => {
    cachedSession = session;
    if (event === 'SIGNED_OUT') cachedSession = null;
    callback(session);
  });
  return () => data.subscription.unsubscribe();
}

/** 测试专用：重置单例与缓存。 */
export function __resetAuthSessionForTests(): void {
  client = null;
  cachedSession = null;
}
