import type { SegmentedProject } from '../types';
import type { SegmentedProjectStorage } from '../services/segmentedProjectStorage';

export interface RecoverStaleProjectParams {
  projectId: string;
  storage: SegmentedProjectStorage;
  /** draftSync.adoptBackendVersion：把后端版本写入草稿为新的干净 base */
  adoptBackendVersion: (p: SegmentedProject) => Promise<void>;
  /** 把恢复的项目应用到 UI 状态（setProject + LOAD_PROJECT） */
  applyProject: (p: SegmentedProject) => void;
  /** 版本迁移（migrateV1），可选 */
  migrate?: (p: SegmentedProject) => SegmentedProject;
}

/**
 * 409 stale_payload 恢复：整量 PUT 被乐观锁拒绝，说明本地草稿基于过期的
 * 服务端版本。拉取后端权威态、重置草稿 base 并应用到 UI；返回恢复的项目，
 * 项目不存在时返回 undefined（不做任何变更）。
 */
export async function recoverStaleProject(
  params: RecoverStaleProjectParams,
): Promise<SegmentedProject | undefined> {
  const fresh = await params.storage.getProject(params.projectId);
  if (!fresh) return undefined;
  const migrated = params.migrate ? params.migrate(fresh) : fresh;
  await params.adoptBackendVersion(migrated);
  params.applyProject(migrated);
  return migrated;
}
