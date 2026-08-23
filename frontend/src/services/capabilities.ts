/**
 * 部署能力探测（Cloudflare 部署 spec 第 4 节）。
 *
 * `GET /api/config/capabilities` 返回当前部署目标可用的引擎/克隆引擎/功能开关；
 * 前端据此隐藏或禁用本地专属能力。常量与后端
 * `backend/app/core/deploy_capabilities.py` 互为镜像，改动必须两侧同步。
 */
import axios from 'axios';
import { apiUrl } from './apiBase';

export interface Capabilities {
  deploy_target: string;
  engines: string[];
  clone_engines: string[];
  features: {
    speech_to_text: boolean;
    agent_workflow: boolean;
    backend_storage: boolean;
    /** 克隆音频直传 Supabase Storage（workers=true；local=false 走 multipart 上传） */
    direct_storage_upload: boolean;
  };
}

/** 本地全量能力：探测失败或未包 Provider 时的默认值（本地开发体验不变）。 */
export const LOCAL_CAPABILITIES: Capabilities = {
  deploy_target: 'local',
  engines: ['edge_tts', 'mimo_tts', 'cosyvoice', 'voxcpm', 'indextts'],
  clone_engines: ['qwen', 'mimo', 'voxcpm'],
  features: { speech_to_text: true, agent_workflow: true, backend_storage: true, direct_storage_upload: false },
};

export async function fetchCapabilities(): Promise<Capabilities> {
  const { data } = await axios.get<Capabilities>(apiUrl('/config/capabilities'), { withCredentials: true });
  return data;
}

/** 运行时校验探测载荷：畸形响应（如本地 80 端口返回的非 JSON 页面）按 local 全量回退。 */
export function isCapabilities(value: unknown): value is Capabilities {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<Capabilities>;
  return (
    typeof v.deploy_target === 'string'
    && Array.isArray(v.engines)
    && Array.isArray(v.clone_engines)
    && !!v.features
    && typeof v.features === 'object'
    && typeof v.features.speech_to_text === 'boolean'
    && typeof v.features.agent_workflow === 'boolean'
    && typeof v.features.backend_storage === 'boolean'
    && typeof v.features.direct_storage_upload === 'boolean'
  );
}
