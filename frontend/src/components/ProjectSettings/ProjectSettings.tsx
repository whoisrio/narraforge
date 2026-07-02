import type { SegmentedProject } from '../../types';
import { useTranslation } from '../../i18n';
import styles from './ProjectSettings.module.css';

type ProjectSettingsMeta = Pick<SegmentedProject, 'description' | 'export_directory'>;

interface ProjectSettingsProps {
  projectName: string;
  remotionPath?: string | null;
  storageMode: string;
  chapterCount: number;
  projectDescription?: string | null;
  exportDirectory?: string | null;
  onRenameProject: (name: string) => void;
  onUpdateRemotionPath: (path: string | null) => void;
  onUpdateProjectMeta: (meta: Partial<ProjectSettingsMeta>) => void;
  onBackToOverview: () => void;
}

export function ProjectSettings({
  projectName,
  remotionPath,
  storageMode,
  chapterCount,
  projectDescription,
  exportDirectory,
  onRenameProject,
  onUpdateRemotionPath,
  onUpdateProjectMeta,
  onBackToOverview,
}: ProjectSettingsProps) {
  const { t } = useTranslation();

  const storageLabel = storageMode === 'backend' ? t('settings.backend') : t('settings.frontend');
  return (
    <section className={styles.root}>
      <header className={styles.header}>
        <div>
          <span className={styles.kicker}>Project Settings</span>
          <h2>项目设置</h2>
          <p>管理项目基本信息与视频导出配置。</p>
        </div>
        <button type="button" onClick={onBackToOverview}>返回总览</button>
      </header>

      <div className={styles.grid}>
        <section className={styles.card}>
          <span className={styles.kicker}>基本信息</span>
          <label className={styles.field}>
            <span>项目名称</span>
            <input aria-label="项目名称" value={projectName} onChange={(event) => onRenameProject(event.target.value)} />
          </label>
          <label className={styles.field}>
            <span>项目描述</span>
            <textarea
              aria-label="项目描述"
              value={projectDescription ?? ''}
              placeholder="这个项目的内容方向、发布平台或制作备注"
              onChange={(event) => onUpdateProjectMeta({ description: event.target.value || null })}
            />
          </label>
          <div className={styles.metaList}>
            <div><span>章节数量</span><strong>{chapterCount} 章</strong></div>
            <div><span>{t('settings.storageMode')}</span><strong>{storageLabel}</strong></div>
          </div>
        </section>

        <section className={styles.card}>
          <span className={styles.kicker}>视频项目</span>
          <label className={styles.field}>
            <span>Remotion 项目路径</span>
            <input
              aria-label="Remotion 项目路径"
              value={remotionPath ?? ''}
              placeholder="/path/to/remotion-project"
              onChange={(event) => onUpdateRemotionPath(event.target.value || null)}
            />
          </label>
          <label className={styles.field}>
            <span>默认导出目录</span>
            <input
              aria-label="默认导出目录"
              value={exportDirectory ?? 'public/audio'}
              placeholder="public/audio"
              onChange={(event) => onUpdateProjectMeta({ export_directory: event.target.value || null })}
            />
            <small style={{ color: 'var(--color-text-secondary)', fontSize: '0.8rem', marginTop: '4px', display: 'block' }}>
              相对于 Remotion 项目路径的目录，导出时会自动创建
            </small>
          </label>
        </section>
      </div>
    </section>
  );
}
