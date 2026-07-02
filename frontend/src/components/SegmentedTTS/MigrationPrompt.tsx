import { useState } from 'react';
import type { MigrationResult } from '../../services/segmentedMigration';
import { useTranslation } from '../../i18n';
import { migrateIndexedDBProjectsToBackend, clearLocalProjects } from '../../services/segmentedMigration';

interface Props {
  localCount: number;
  onComplete: () => void;
  onDismiss: () => void;
}

export function MigrationPrompt({ localCount, onComplete, onDismiss }: Props) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<MigrationResult[] | null>(null);

  const run = async () => {
    setBusy(true);
    try {
      const r = await migrateIndexedDBProjectsToBackend();
      setResults(r);
      const okIds = r.filter((x) => x.status === 'ok').map((x) => x.project_id);
      await clearLocalProjects(okIds);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="migration-prompt">
      <h3>{t('segment.migration.title')}</h3>
      {results == null && (
        <>
          <p>{t('segment.migration.prompt', { count: localCount })}</p>
          <button onClick={run} disabled={busy}>{t('segment.migration.run')}</button>
          <button onClick={onDismiss} disabled={busy}>{t('segment.migration.dismiss')}</button>
        </>
      )}
      {results != null && (
        <>
          <p>{t('segment.migration.result', { ok: results.filter((r) => r.status === 'ok').length, error: results.filter((r) => r.status === 'error').length })}</p>
          <button onClick={onComplete}>{t('segment.migration.done')}</button>
        </>
      )}
    </div>
  );
}
