import { useState } from 'react';
import type { SegmentedProject } from '../../types';
import { useTranslation } from '../../i18n';
import { ImageUploadZone } from '../ui/ImageUploadZone';
import styles from './ProjectHub.module.css';

interface ProjectHubProps {
  projects: SegmentedProject[];
  onOpenProject: (projectId: string) => void;
  onCreateProject: (name: string, logo?: string | null) => void;
  onDeleteProject: (projectId: string) => void;
  onRenameProject: (projectId: string, name: string) => void;
}

function projectStats(project: SegmentedProject) {
  if (project.summary_stats) {
    return {
      chapters: project.summary_stats.chapter_count,
      segments: project.summary_stats.segment_count,
      generated: project.summary_stats.generated_count,
      duration: project.summary_stats.duration_sec,
    };
  }
  const chapters = project.chapters.length;
  const segments = project.chapters.reduce((total, chapter) => total + chapter.segments.length, 0);
  const generated = project.chapters.reduce(
    (total, chapter) => total + chapter.segments.filter(segment => segment.status === 'ready').length,
    0,
  );
  const duration = project.chapters.reduce(
    (total, chapter) => total + chapter.segments.reduce((sum, segment) => sum + (segment.audio.duration_sec ?? 0), 0),
    0,
  );
  return { chapters, segments, generated, duration };
}

function formatDuration(seconds: number) {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes}m ${rest}s`;
}

function projectInitial(name: string) {
  return name.trim().slice(0, 1).toUpperCase() || 'N';
}

export function ProjectHub({ projects, onOpenProject, onCreateProject, onDeleteProject, onRenameProject }: ProjectHubProps) {
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [openMenuProjectId, setOpenMenuProjectId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createLogo, setCreateLogo] = useState<string | null>(null);
  const { t } = useTranslation();
  const totalSegments = projects.reduce((total, project) => total + projectStats(project).segments, 0);
  const totalGenerated = projects.reduce((total, project) => total + projectStats(project).generated, 0);

  const startRename = (project: SegmentedProject) => {
    setEditingProjectId(project.id);
    setOpenMenuProjectId(null);
    setRenameDraft(project.name);
  };

  const saveRename = (project: SegmentedProject) => {
    const nextName = renameDraft.trim();
    if (!nextName) {
      setEditingProjectId(null);
      setRenameDraft('');
      return;
    }
    if (nextName !== project.name) {
      onRenameProject(project.id, nextName);
    }
    setEditingProjectId(null);
    setRenameDraft('');
  };

  const handleCreate = () => {
    const name = createName.trim() || `${t('projectHub.createDefault')} ${projects.filter(p => !p.name.startsWith(t('projectHub.tempProject'))).length + 1}`;
    onCreateProject(name, createLogo);
    setShowCreateDialog(false);
    setCreateName('');
    setCreateLogo(null);
  };

  return (
    <section className={styles.root}>
      <header className={styles.hero}>
        <div>
          <span className={styles.kicker}>Projects</span>
          <h1>{t('projectHub.title')}</h1>
          <p>{t('projectHub.subtitle')}</p>
        </div>
        <div className={styles.heroStats}>
          <div><span>{t('projectHub.stats.projects')}</span><strong>{projects.length}</strong></div>
          <div><span>{t('projectHub.stats.segments')}</span><strong>{totalSegments}</strong></div>
          <div><span>{t('projectHub.stats.generated')}</span><strong>{totalGenerated}</strong></div>
        </div>
      </header>

      <div className={styles.grid}>
        <button type="button" className={styles.createCard} onClick={() => setShowCreateDialog(true)}>
          <span className={styles.createIcon}>+</span>
          <strong>{t('projectHub.createCard.title')}</strong>
          <small>{t('projectHub.createCard.description')}</small>
        </button>

        {projects.map(project => {
          const stats = projectStats(project);
          const progress = stats.segments === 0 ? 0 : Math.round((stats.generated / stats.segments) * 100);
          const isEditing = editingProjectId === project.id;
          const isMenuOpen = openMenuProjectId === project.id;
          return (
            <article key={project.id} className={styles.projectCard} aria-label={`项目 ${project.name}`} data-card-variant="compact-project-card">
              <div className={styles.cardHead}>
                {isEditing ? (
                  <div className={styles.cardOpenButton}>
                    {project.logo ? (
                      <img src={project.logo} alt="" className={styles.projectLogo} />
                    ) : (
                      <span className={styles.projectInitial}>{projectInitial(project.name)}</span>
                    )}
                    <span className={styles.cardTitleBlock}>
                      <span className={styles.renameForm}>
                        <label htmlFor={`project-name-${project.id}`}>{t('projectHub.rename.label')}</label>
                        <input
                          id={`project-name-${project.id}`}
                          value={renameDraft}
                          onChange={(event) => setRenameDraft(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') saveRename(project);
                            if (event.key === 'Escape') {
                              setEditingProjectId(null);
                              setRenameDraft('');
                            }
                          }}
                          autoFocus
                        />
                      </span>
                    </span>
                  </div>
                ) : (
                  <button
                    type="button"
                    className={styles.cardOpenButton}
                    aria-label={`打开 ${project.name}`}
                    onClick={() => onOpenProject(project.id)}
                  >
                  {project.logo ? (
                    <img src={project.logo} alt="" className={styles.projectLogo} />
                  ) : (
                    <span className={styles.projectInitial}>{projectInitial(project.name)}</span>
                  )}
                  <span className={styles.cardTitleBlock}>
                    <strong>{project.name}</strong>
                    <small>{project.active_narration_version ?? t('projectHub.defaultVersion')}</small>
                  </span>
                  </button>
                )}
                <span className={styles.statusBadge}>
                  {progress === 100 && stats.segments > 0 ? t('projectHub.status.completed') : t('projectHub.status.inProgress')}
                </span>
              </div>
              <div className={styles.cardBody}>
                {isEditing ? (
                  <div className={styles.renameActions}>
                    <button type="button" onClick={() => saveRename(project)}>{t('projectHub.rename.save')}</button>
                    <button type="button" onClick={() => { setEditingProjectId(null); setRenameDraft(''); }}>{t('projectHub.rename.cancel')}</button>
                  </div>
                ) : null}
                <div className={styles.cardStats}>
                  <span>{stats.chapters} {t('projectHub.stats_labels.chapters')}</span>
                  <span>{stats.segments} {t('projectHub.stats_labels.segments')}</span>
                  <span>{formatDuration(stats.duration)}</span>
                </div>
                <div className={styles.progressBlock}>
                  <div className={styles.progressCopy}>
                    <span>{stats.generated}/{stats.segments} {t('projectHub.stats_labels.generated')}</span>
                    <strong>{progress}%</strong>
                  </div>
                  <div className={styles.progressTrack}>
                    <span style={{ width: `${progress}%` }} />
                  </div>
                </div>
                <div className={styles.cardFooter}>
                  <div className={styles.menuWrap}>
                    <button
                      type="button"
                      className={styles.menuButton}
                      aria-label={`项目操作 ${project.name}`}
                      aria-haspopup="menu"
                      aria-expanded={isMenuOpen}
                      onClick={() => setOpenMenuProjectId(isMenuOpen ? null : project.id)}
                    >
                      ⋯
                    </button>
                    {isMenuOpen && (
                      <div className={styles.actionMenu} role="menu" aria-label={`${project.name} ${t('projectHub.actions.delete')}`}>
                        <button type="button" role="menuitem" onClick={() => onOpenProject(project.id)}>{t('projectHub.actions.open')}</button>
                        <button type="button" role="menuitem" onClick={() => startRename(project)}>{t('projectHub.actions.rename')}</button>
                        <button
                          type="button"
                          role="menuitem"
                          className={styles.menuDanger}
                          onClick={() => { setOpenMenuProjectId(null); onDeleteProject(project.id); }}
                        >
                          {t('projectHub.actions.delete')}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      {projects.length === 0 && (
        <div className={styles.emptyState}>
          <h2>{t('projectHub.emptyState.title')}</h2>
          <p>{t('projectHub.emptyState.description')}</p>
        </div>
      )}

      {/* Create project dialog */}
      {showCreateDialog && (
        <div className={styles.dialogOverlay} onClick={() => setShowCreateDialog(false)}>
          <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
            <h3 className={styles.dialogTitle}>{t('projectHub.dialog.title')}</h3>
            <div className={styles.dialogBody}>
              <ImageUploadZone
                value={createLogo}
                onChange={setCreateLogo}
                size="lg"
              />
              <label className={styles.dialogLabel}>
                {t('projectHub.dialog.nameLabel')}
                <input
                  className={styles.dialogInput}
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  placeholder={t('projectHub.dialog.namePlaceholder')}
                  autoFocus
                  onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
                />
              </label>
            </div>
            <div className={styles.dialogActions}>
              <button type="button" className={styles.dialogCancelBtn} onClick={() => setShowCreateDialog(false)}>{t('projectHub.dialog.cancel')}</button>
              <button type="button" className={styles.dialogCreateBtn} onClick={handleCreate}>{t('projectHub.dialog.create')}</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
