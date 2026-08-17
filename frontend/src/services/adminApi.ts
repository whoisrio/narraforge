/**
 * 管理后台 API（spec 5.2c · M7）。
 *
 * 后端要求登录用户邮箱在服务端 admin 名单内，否则 403 {detail:{code:"admin_required"}}。
 * 响应用 typed adapter 做了字段兜底：后端分页信封/字段名若有细微出入，
 * UI 层拿到的是稳定的前端类型，不会整页崩掉。
 */
import api from './api';

export interface AdminOverview {
  total_users: number;
  today_dau: number;
  dau_series: { date: string; count: number }[];
  visit_series: { date: string; authed: number; anon: number }[];
}

export interface AdminUserItem {
  id: string;
  email: string;
  created_at: string | null;
  last_seen_at: string | null;
  is_admin: boolean;
}

export interface AdminLogItem {
  id: string;
  user_id: string | null;
  action: string;
  method: string;
  path: string;
  status: number | null;
  duration_ms: number | null;
  created_at: string | null;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function strOrNull(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function adaptOverview(raw: unknown): AdminOverview {
  const r = (raw ?? {}) as Record<string, unknown>;
  const dauSeries = Array.isArray(r.dau_series) ? r.dau_series : [];
  const visitSeries = Array.isArray(r.visit_series) ? r.visit_series : [];
  return {
    total_users: num(r.total_users),
    today_dau: num(r.today_dau),
    dau_series: dauSeries.map((p) => {
      const point = (p ?? {}) as Record<string, unknown>;
      return { date: str(point.date), count: num(point.count) };
    }),
    visit_series: visitSeries.map((p) => {
      const point = (p ?? {}) as Record<string, unknown>;
      return { date: str(point.date), authed: num(point.authed), anon: num(point.anon) };
    }),
  };
}

function adaptUser(raw: unknown): AdminUserItem {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    id: str(r.id),
    email: str(r.email),
    created_at: strOrNull(r.created_at),
    last_seen_at: strOrNull(r.last_seen_at),
    is_admin: r.is_admin === true,
  };
}

function adaptLog(raw: unknown): AdminLogItem {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    id: str(r.id),
    user_id: strOrNull(r.user_id),
    action: str(r.action),
    method: str(r.method),
    path: str(r.path),
    status: typeof r.status === 'number' ? r.status : null,
    duration_ms: typeof r.duration_ms === 'number' ? r.duration_ms : null,
    created_at: strOrNull(r.created_at),
  };
}

function adaptPaginated<T>(raw: unknown, adaptItem: (item: unknown) => T): Paginated<T> {
  const r = (raw ?? {}) as Record<string, unknown>;
  const items = Array.isArray(r.items) ? r.items : [];
  return {
    items: items.map(adaptItem),
    total: num(r.total, items.length),
    page: num(r.page, 1),
    page_size: num(r.page_size, items.length || 20),
  };
}

export const adminApi = {
  getOverview: async (): Promise<AdminOverview> => {
    const { data } = await api.get('/admin/stats/overview');
    return adaptOverview(data);
  },

  getUsers: async (page = 1, pageSize = 20): Promise<Paginated<AdminUserItem>> => {
    const { data } = await api.get('/admin/users', { params: { page, page_size: pageSize } });
    return adaptPaginated(data, adaptUser);
  },

  getLogs: async (
    page = 1,
    pageSize = 20,
    filters: { user_id?: string; action?: string; date?: string } = {},
  ): Promise<Paginated<AdminLogItem>> => {
    const params: Record<string, string | number> = { page, page_size: pageSize };
    if (filters.user_id) params.user_id = filters.user_id;
    if (filters.action) params.action = filters.action;
    if (filters.date) params.date = filters.date;
    const { data } = await api.get('/admin/logs', { params });
    return adaptPaginated(data, adaptLog);
  },
};

/** 从 axios 错误中提取 HTTP 状态码（403 → 非管理员）。 */
export function errorStatus(error: unknown): number | null {
  const status = (error as { response?: { status?: number } })?.response?.status;
  return typeof status === 'number' ? status : null;
}
