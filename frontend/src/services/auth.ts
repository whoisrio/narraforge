/**
 * 共享口令认证（无域名 Vercel + Pages 直连部署，spec 5.2b）。
 *
 * 构建期开关 `VITE_AUTH_REQUIRED=true`（Cloudflare Pages 环境变量）启用；
 * 本地开发不设置该变量时 `isAuthRequired()` 恒为 false，前端行为与历史完全一致。
 *
 * 口令存 localStorage（`nf_access_token`），由各 axios 实例的请求拦截器注入
 * `Authorization: Bearer <token>`；后端 workers 中间件用 hmac.compare_digest 比对。
 * 任意请求收到 401 → 口令失效：清除本地口令并整页刷新，重新走解锁页。
 */
import type { AxiosInstance } from 'axios';

const TOKEN_KEY = 'nf_access_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export function isAuthRequired(): boolean {
  return import.meta.env.VITE_AUTH_REQUIRED === 'true';
}

/** 整页刷新（解锁成功 / 口令失效后重新初始化，Capabilities 等启动探测随之重试）。 */
export function reloadPage(): void {
  window.location.reload();
}

/**
 * 给 axios 实例挂载认证拦截器：
 * - 请求：auth 开启且本地有口令时注入 Bearer 头；
 * - 响应：auth 开启时收到 401 → 清除口令并整页刷新（回到解锁页）。
 */
export function applyAuthInterceptors(instance: AxiosInstance): void {
  instance.interceptors.request.use((config) => {
    const token = getToken();
    if (isAuthRequired() && token) {
      config.headers.set('Authorization', `Bearer ${token}`);
    }
    return config;
  });
  instance.interceptors.response.use(undefined, (error: unknown) => {
    const status = (error as { response?: { status?: number } })?.response?.status;
    if (isAuthRequired() && status === 401) {
      clearToken();
      reloadPage();
    }
    return Promise.reject(error);
  });
}
