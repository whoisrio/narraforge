/**
 * Supabase Auth 请求注入与 401 处理（spec 5.2c）。
 *
 * 构建期开关 `VITE_AUTH_REQUIRED=true`（Cloudflare Pages 环境变量）启用；
 * 本地开发不设置该变量时 `isAuthRequired()` 恒为 false，前端行为与历史完全一致。
 *
 * access_token 来自 Supabase 会话（见 ./authSession），由各 axios 实例的
 * 异步请求拦截器注入 `Authorization: Bearer <token>`；后端 workers 中间件验签。
 * 任意请求收到 401：已登录用户先 refreshSession 重试一次，仍失败则本地登出并
 * 通过 setUnauthorizedHandler 注册的回调回到登录页（React 状态驱动，无整页刷新）；
 * 匿名用户（无会话）的 401 不做副作用，由调用方 UI 处理（anonymous allowlist 之外的端点）。
 */
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import { getAccessToken, refreshSession, signOutLocal } from './authSession';

export function isAuthRequired(): boolean {
  return import.meta.env.VITE_AUTH_REQUIRED === 'true';
}

type UnauthorizedHandler = () => void;
let onUnauthorized: UnauthorizedHandler | null = null;

/** 会话彻底失效（refresh 失败）后的回调，由 AuthProvider 注册以驱动 UI 回到登录态。 */
export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  onUnauthorized = handler;
}

type RetriableConfig = InternalAxiosRequestConfig & { __authRetried?: boolean };

/**
 * 给 axios 实例挂载认证拦截器：
 * - 请求：auth 开启且 Supabase 会话存在时注入 Bearer 头；
 * - 响应：auth 开启时收到 401 → 有会话则 refresh 重试一次；仍失败 → 本地登出并回调。
 */
export function applyAuthInterceptors(instance: AxiosInstance): void {
  instance.interceptors.request.use(async (config) => {
    if (!isAuthRequired()) return config;
    const token = await getAccessToken();
    if (token) {
      config.headers.set('Authorization', `Bearer ${token}`);
    }
    return config;
  });
  instance.interceptors.response.use(undefined, async (error: unknown) => {
    const err = error as { response?: { status?: number }; config?: RetriableConfig };
    const status = err?.response?.status;
    if (!isAuthRequired() || status !== 401 || !err.config) {
      return Promise.reject(error);
    }
    // 匿名请求（无会话）命中 401：属 allowlist 之外的正常拒绝，不做刷新/登出副作用
    const token = await getAccessToken();
    if (!token) {
      return Promise.reject(error);
    }
    if (!err.config.__authRetried) {
      err.config.__authRetried = true;
      const newToken = await refreshSession();
      if (newToken) {
        err.config.headers.set('Authorization', `Bearer ${newToken}`);
        return instance.request(err.config);
      }
    }
    signOutLocal();
    onUnauthorized?.();
    return Promise.reject(error);
  });
}
