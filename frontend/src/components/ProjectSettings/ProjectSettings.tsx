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
          <h2>{t('projectSettings.title')}</h2>
          <p>{t('projectSettings.description')}</p>
        </div>
        <button type="button" onClick={onBackToOverview}>{t('projectSettings.backToOverview')}</button>
      </header>

      <div className={styles.grid}>
        <section className={styles.card}>
          <span className={styles.kicker}>{t('projectSettings.basicInfo')}</span>
          <label className={styles.field}>
            <span>{t('projectSettings.projectName')}</span>
            <input aria-label={t('projectSettings.projectName')} value={projectName} onChange={(event) => onRenameProject(event.target.value)} />
          </label>
          <label className={styles.field}>
            <span>{t('projectSettings.projectDescription')}</span>
            <textarea
              aria-label={t('projectSettings.projectDescription')}
              value={projectDescription ?? ''}
              placeholder={t('projectSettings.description')}
              onChange={(event) => onUpdateProjectMeta({ description: event.target.value || null })}
            />
          </label>
          <div className={styles.metaList}>
            <div><span>{t('projectSettings.chapterCount', { count: chapterCount })}</span></div>
            <div><span>{t('settings.storageMode')}</span><strong>{storageLabel}</strong></div>
          </div>
        </section>

        <section className={styles.card}>
          <span className={styles.kicker}>{t('projectSettings.videoProject')}</span>
          <label className={styles.field}>
            <span>{t('projectSettings.remotionPath')}</span>
            <input
              aria-label={t('projectSettings.remotionPath')}
              value={remotionPath ?? ''}
              placeholder={t('projectSettings.remotionPathPlaceholder')}
              onChange={(event) => onUpdateRemotionPath(event.target.value || null)}
            />
          </label>
          <label className={styles.field}>
            <span>{t('projectSettings.exportDir')}</span>
            <input
              aria-label={t('projectSettings.exportDir')}
              value={exportDirectory ?? 'public/audio'}
              placeholder={t('projectSettings.exportDirPlaceholder')}
              onChange={(event) => onUpdateProjectMeta({ export_directory: event.target.value || null })}
            />
            <small style={{ color: 'var(--color-text-secondary)', fontSize: '0.8rem', marginTop: '4px', display: 'block' }}>
              {t('projectSettings.exportDirHint')}
            </small>
          </label>
        </section>
      </div>
    </section>
  );
}
