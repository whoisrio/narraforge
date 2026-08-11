/**
 * API base 解析（Cloudflare 部署 spec 第 4 节）。
 *
 * 本地开发：未设 `VITE_API_BASE_URL` 时一律走 `/api`（Vite dev proxy），行为与历史完全一致。
 * workers 部署：`VITE_API_BASE_URL=https://api.<域名>/api`，所有请求指向独立 API 域名。
 */

const envBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/+$/, '');

export const API_BASE_URL: string = envBase || '/api';

/** 把 API 路径（可带或不带前导斜杠）拼成完整 URL。 */
export function apiUrl(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE_URL}${normalized}`;
}
