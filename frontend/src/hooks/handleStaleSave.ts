import type { SegmentedProject } from '../types';
import type { SegmentedProjectStorage } from '../services/segmentedProjectStorage';
import type { ProjectDraftRecord } from '../services/segmentedDraftStore';
import { getDraft } from '../services/segmentedDraftStore';
import { putConflictedDraft } from '../services/conflictedDraftStore';

export type HandleStaleSaveStatus =
  | 'prompted'    // 已弹窗等用户裁决（pause 保持，由裁决动作 resume）
  | 'no-draft'    // 草稿记录不存在，无事可裁决
  | 'not-found'   // 后端项目已不存在
  | 'fetch-failed'; // 拉取后端失败（已 resume，等下一轮保存重试）

export interface HandleStaleSaveParams {
  projectId: string;
  storage: SegmentedProjectStorage;
  /** 冲突裁决期间暂停 autosave（防弹窗期间继续 PUT→409 循环）。 */
  pause: () => void;
  /** 失败路径由本函数自行调用；'prompted' 时留给裁决动作调用。 */
  resume: () => void;
  /** 弹出冲突裁决 UI（backend 为后端权威态，draft 为刚归档的本地草稿）。 */
  openPrompt: (backend: SegmentedProject, draft: ProjectDraftRecord) => void;
  /** 版本迁移（migrateV1），可选。 */
  migrate?: (p: SegmentedProject) => SegmentedProject;
}

/**
 * 409 stale_payload 真冲突处理（第二层）：
 * 旧实现（recoverStaleProject）直接 adopt 后端态、静默丢弃本地草稿；
 * 新流程 = pause autosave → 归档草稿（带时间戳，可找回）→ 拉后端权威态 →
 * 弹冲突裁决窗，由用户选择"用草稿"（force save）或"用后端"（adopt）。
 * 任何路径都不静默丢弃草稿。
 */
export async function handleStaleSave(
  params: HandleStaleSaveParams,
): Promise<HandleStaleSaveStatus> {
  const { projectId, storage, pause, resume, openPrompt, migrate } = params;
  pause();
  const rec = await getDraft(projectId);
  if (!rec) {
    resume();
    return 'no-draft';
  }
  await putConflictedDraft(projectId, rec);
  let backend: SegmentedProject | undefined;
  try {
    backend = await storage.getProject(projectId);
  } catch {
    // 拉取失败：保持数据原样、恢复 autosave，下一轮保存重走冲突流程（幂等）
    resume();
    return 'fetch-failed';
  }
  if (!backend) {
    resume();
    return 'not-found';
  }
  const migrated = migrate ? migrate(backend) : backend;
  openPrompt(migrated, rec);
  return 'prompted';
}
