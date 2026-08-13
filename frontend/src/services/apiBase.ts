/**
 * API base 解析（Cloudflare 部署 spec 第 4 节）。
 *
 * 本地开发：未设 `VITE_API_BASE_URL` 时一律走 `/api`（Vite dev proxy），行为与历史完全一致。
 * workers 部署：`VITE_API_BASE_URL=https://api.<域名>/api`，所有请求指向独立 API 域名。
 */

const envBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/+$/, '');

// 设了 VITE_API_BASE_URL 就必须是带 scheme 的绝对 URL——否则浏览器会把它当相对路径
// 拼到前端域名后面，SPA 回退返回 index.html 200，极难排查。宁可启动即报错。
if (envBase && !/^https?:\/\//.test(envBase)) {
  throw new Error(
    `VITE_API_BASE_URL 必须是完整 URL（含 https://），当前值: "${envBase}"，` +
      `正确示例: https://<project>.vercel.app/api`,
  );
}

export const API_BASE_URL: string = envBase || '/api';

/** 把 API 路径（可带或不带前导斜杠）拼成完整 URL。 */
export function apiUrl(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE_URL}${normalized}`;
}
