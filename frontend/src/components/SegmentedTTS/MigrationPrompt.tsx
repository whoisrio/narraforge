import { useState } from 'react';
import type { MigrationResult } from '../../services/segmentedMigration';
import { migrateIndexedDBProjectsToBackend, clearLocalProjects } from '../../services/segmentedMigration';

interface Props {
  localCount: number;
  onComplete: () => void;
  onDismiss: () => void;
}

export function MigrationPrompt({ localCount, onComplete, onDismiss }: Props) {
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
      <h3>迁移本地项目到后端</h3>
      {results == null && (
        <>
          <p>检测到本地有 {localCount} 个分段项目，是否迁移到后端存储？</p>
          <button onClick={run} disabled={busy}>迁移</button>
          <button onClick={onDismiss} disabled={busy}>稍后再说</button>
        </>
      )}
      {results != null && (
        <>
          <p>迁移完成：{results.filter((r) => r.status === 'ok').length} 成功 / {results.filter((r) => r.status === 'error').length} 失败</p>
          <button onClick={onComplete}>完成</button>
        </>
      )}
    </div>
  );
}
