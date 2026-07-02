import type { SegmentedProject } from '../../types';
import type { ProjectDraftRecord } from '../../services/segmentedDraftStore';
import { useTranslation } from '../../i18n';

interface Props {
  backend: SegmentedProject;
  draft: ProjectDraftRecord;
  onUseBackend: () => void;
  onUseDraft: () => void;
}

export function ConflictPrompt({ backend, draft, onUseBackend, onUseDraft }: Props) {
  const { t } = useTranslation();
  return (
    <div className="conflict-prompt">
      <h3>{t('segment.conflict.title')}</h3>
      <p>{t('segment.conflict.backendVersion')}: {backend.updated_at}</p>
      <p>{t('segment.conflict.localDraft')}: {draft.updated_at}</p>
      <p>{t('segment.conflict.prompt')}</p>
      <button onClick={onUseDraft}>{t('segment.conflict.useDraft')}</button>
      <button onClick={onUseBackend}>{t('segment.conflict.useBackend')}</button>
    </div>
  );
}
