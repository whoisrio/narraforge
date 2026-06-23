import styles from './ProjectSettings.module.css';

interface ProjectSettingsProps {
  projectName: string;
  remotionPath?: string | null;
  defaultNarratorName?: string | null;
  storageMode: string;
  chapterCount: number;
  onRenameProject: (name: string) => void;
  onUpdateRemotionPath: (path: string | null) => void;
  onBackToOverview: () => void;
}

export function ProjectSettings({
  projectName,
  remotionPath,
  defaultNarratorName,
  storageMode,
  chapterCount,
  onRenameProject,
  onUpdateRemotionPath,
  onBackToOverview,
}: ProjectSettingsProps) {
  return (
    <section className={styles.root}>
      <header className={styles.header}>
        <div>
          <span className={styles.kicker}>Project Settings</span>
          <h2>项目设置</h2>
          <p>管理项目元信息、Remotion 导出目标和默认生产约定。</p>
        </div>
        <button type="button" onClick={onBackToOverview}>返回总览</button>
      </header>

      <div className={styles.grid}>
        <section className={styles.card}>
          <span className={styles.kicker}>Metadata</span>
          <label className={styles.field}>
            <span>项目名称</span>
            <input aria-label="项目名称" value={projectName} onChange={(event) => onRenameProject(event.target.value)} />
          </label>
          <div className={styles.metaList}>
            <div><span>章节数量</span><strong>{chapterCount} 章</strong></div>
            <div><span>存储模式</span><strong>{storageMode}</strong></div>
            <div><span>默认旁白</span><strong>{defaultNarratorName || '未设置默认旁白'}</strong></div>
          </div>
        </section>

        <section className={styles.card}>
          <span className={styles.kicker}>Remotion / Export</span>
          <label className={styles.field}>
            <span>Remotion 项目路径</span>
            <input
              aria-label="Remotion 项目路径"
              value={remotionPath ?? ''}
              placeholder="/path/to/remotion-project"
              onChange={(event) => onUpdateRemotionPath(event.target.value || null)}
            />
          </label>
          <div className={styles.exportRule}>
            <strong>Studio 导出</strong>
            <p>导出动作保留在工作室；设置页只保存默认路径与命名约定。音频优先写入 Remotion 项目的 public/audio。</p>
          </div>
        </section>

        <section className={styles.card}>
          <span className={styles.kicker}>Defaults</span>
          <div className={styles.metaList}>
            <div><span>默认声音角色</span><strong>{defaultNarratorName || '未设置'}</strong></div>
            <div><span>默认导出命名</span><strong>章节标题 + 时间戳</strong></div>
            <div><span>高级</span><strong>生成历史与存储策略</strong></div>
          </div>
        </section>
      </div>
    </section>
  );
}
