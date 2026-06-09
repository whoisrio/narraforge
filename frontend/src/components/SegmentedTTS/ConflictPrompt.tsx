import type { SegmentedProject } from '../../types';
import type { ProjectDraftRecord } from '../../services/segmentedDraftStore';

interface Props {
  backend: SegmentedProject;
  draft: ProjectDraftRecord;
  onUseBackend: () => void;
  onUseDraft: () => void;
}

export function ConflictPrompt({ backend, draft, onUseBackend, onUseDraft }: Props) {
  return (
    <div className="conflict-prompt">
      <h3>检测到版本冲突</h3>
      <p>后端版本: {backend.updated_at}</p>
      <p>本地草稿: {draft.updated_at}</p>
      <p>本地草稿基于旧版本，恢复本地修改或使用后端版本？</p>
      <button onClick={onUseDraft}>恢复本地草稿</button>
      <button onClick={onUseBackend}>使用后端版本</button>
    </div>
  );
}
