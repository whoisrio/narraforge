/**
 * 用量统计 API（Phase 3 后端计量）。
 *
 * 响应用 typed adapter 做了数值字段兜底：后端字段若有细微出入，
 * UI 层拿到的是稳定的前端类型，不会整页崩掉。
 * Token 口径：API 返回优先，未提供时后端按字符数估算（见 UI 脚注）。
 */
import api from './api';

export interface ProjectUsage {
  project_id: string;
  tts_count: number;
  chars: number;
  input_tokens: number;
  output_tokens: number;
}

export interface GlobalUsageProject extends ProjectUsage {
  project_name: string;
}

export interface UsageTotals {
  tts_count: number;
  chars: number;
  input_tokens: number;
  output_tokens: number;
}

export interface GlobalUsage {
  projects: GlobalUsageProject[];
  totals: UsageTotals;
}

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

export function adaptProjectUsage(raw: unknown): ProjectUsage {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    project_id: str(r.project_id),
    tts_count: num(r.tts_count),
    chars: num(r.chars),
    input_tokens: num(r.input_tokens),
    output_tokens: num(r.output_tokens),
  };
}

export function adaptGlobalUsage(raw: unknown): GlobalUsage {
  const r = (raw ?? {}) as Record<string, unknown>;
  const projects = Array.isArray(r.projects) ? r.projects : [];
  const t = (r.totals ?? {}) as Record<string, unknown>;
  return {
    projects: projects.map((p) => {
      const item = (p ?? {}) as Record<string, unknown>;
      return { ...adaptProjectUsage(item), project_name: str(item.project_name) };
    }),
    totals: {
      tts_count: num(t.tts_count),
      chars: num(t.chars),
      input_tokens: num(t.input_tokens),
      output_tokens: num(t.output_tokens),
    },
  };
}

export const usageApi = {
  /** 单项目用量（tts 次数 / 字数 / token 输入输出）。 */
  getProjectUsage: async (projectId: string): Promise<ProjectUsage> => {
    const { data } = await api.get(`/segmented-projects/${projectId}/usage`);
    return adaptProjectUsage(data);
  },

  /** 当前用户全部项目用量 + 合计（workers 模式匿名 401；本地模式返回单租户合计）。 */
  getMyUsage: async (): Promise<GlobalUsage> => {
    const { data } = await api.get('/me/usage');
    return adaptGlobalUsage(data);
  },
};

/**
 * token 统计展示开关（2026-08-21）：LLM 计量数据正常记录，但当前全为 0，
 * UI 先隐藏 token 卡片/列；要恢复展示改回 true 即可。
 */
export const SHOW_TOKEN_USAGE = false;
