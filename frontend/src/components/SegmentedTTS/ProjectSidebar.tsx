import type { SegmentedProject, SourceDocument } from '../../types';
import { useTranslation } from '../../i18n';
import styles from './ProjectSidebar.module.css';

interface ProjectSidebarProps {
  projects: SegmentedProject[];
  activeProjectId: string;
  collapsed: boolean;
  scratchpadId: string;
  /** P2 v2: 当前项目的源文件列表 (项目级) */
  activeSources?: SourceDocument[];
  onToggleCollapse: () => void;
  onSelectProject: (projectId: string) => void;
  onCreateProject: () => void;
  onDeleteProject: (projectId: string) => void;
  onAddSource?: () => void;
  onGenerateNarration?: () => void;
}

function getProjectStats(project: SegmentedProject) {
  const segments = project.chapters.reduce((sum, chapter) => sum + chapter.segments.length, 0);
  const ready = project.chapters.reduce(
    (sum, chapter) => sum + chapter.segments.filter(segment => segment.status === 'ready').length,
    0,
  );
  const duration = project.chapters.reduce(
    (sum, chapter) => sum + chapter.segments.reduce((chapterSum, segment) => chapterSum + (segment.audio.duration_sec ?? 0), 0),
    0,
  );

  return { segments, ready, duration };
}

function formatDuration(seconds: number): string {
  if (seconds <= 0) return '0s';
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes}m ${rest}s`;
}

function formatAudioBadge(seconds: number): string {
  // 短音频用 mm:ss (如 "4:32"), 与项目元信息区分
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function ProjectSidebar({
  projects,
  activeProjectId,
  collapsed,
  scratchpadId,
  activeSources = [],
  onToggleCollapse,
  onSelectProject,
  onCreateProject,
  onDeleteProject,
  onAddSource,
  onGenerateNarration,
}: ProjectSidebarProps) {
  const { t } = useTranslation();
  const scratchpad = projects.find(project => project.id === scratchpadId);
  const regularProjects = projects.filter(project => project.id !== scratchpadId);

  const renderProject = (project: SegmentedProject, kind: 'scratchpad' | 'project') => {
    const isScratchpad = kind === 'scratchpad';
    const isActive = project.id === activeProjectId;
    const stats = getProjectStats(project);

    return (
      <div
        key={project.id}
        className={`${styles.projectItem} ${isActive ? styles.projectItemActive : ''}`}
        title={collapsed ? project.name : undefined}
      >
        <button
          type="button"
          className={styles.projectSelectButton}
          onClick={() => onSelectProject(project.id)}
        >
          <span className={styles.projectIcon}>{isScratchpad ? t('segment.projectSidebar.scratchpadIcon') : t('segment.projectSidebar.projectIcon')}</span>
          {!collapsed && (
            <span className={styles.projectBody}>
              <span className={styles.projectTopline}>
                <span className={styles.projectName}>{project.name}</span>
                {isScratchpad && <span className={styles.pinBadge}>{t('segment.projectSidebar.default')}</span>}
              </span>
              <span className={styles.projectMeta}>
                {t('segment.projectSidebar.stats', { segments: stats.segments, ready: stats.ready, duration: formatDuration(stats.duration) })}
              </span>
            </span>
          )}
        </button>
        {!collapsed && !isScratchpad && (
          <button
            type="button"
            className={styles.deleteButton}
            title={t('segment.projectSidebar.deleteProject')}
            aria-label={`${t('segment.projectSidebar.deleteProject')} ${project.name}`}
            onClick={(event) => {
              event.stopPropagation();
              onDeleteProject(project.id);
            }}
          >
            ×
          </button>
        )}
      </div>
    );
  };

  return (
    <aside className={`${styles.sidebar} ${collapsed ? styles.sidebarCollapsed : ''}`}>
      <div className={styles.header}>
        {!collapsed && (
          <div className={styles.titleBlock}>
            <div className={styles.eyebrow}>{t('segment.projectSidebar.projects')}</div>
            <h2 className={styles.title}>{t('segment.projectSidebar.projects')}</h2>
          </div>
        )}
        <div className={styles.headerActions}>
          <button
            type="button"
            className={styles.iconButton}
            onClick={onCreateProject}
            aria-label={t('segment.projectSidebar.newProject')}
            title={t('segment.projectSidebar.newProject')}
          >
            +
          </button>
          <button
            type="button"
            className={styles.iconButton}
            onClick={onToggleCollapse}
            aria-label={collapsed ? t('segment.projectSidebar.expand') : t('segment.projectSidebar.collapse')}
            title={collapsed ? t('segment.projectSidebar.expand') : t('segment.projectSidebar.collapse')}
          >
            {collapsed ? '›' : '‹'}
          </button>
        </div>
      </div>

      <div className={styles.projectList}>
        {scratchpad && (
          <div className={styles.section}>
            {!collapsed && <div className={styles.sectionLabel}>{t('segment.projectSidebar.draft')}</div>}
            {renderProject(scratchpad, 'scratchpad')}
          </div>
        )}

        <div className={styles.section}>
          {!collapsed && (
            <div className={styles.sectionLabelRow}>
              <span className={styles.sectionLabel}>{t('segment.projectSidebar.projects')}</span>
              <span className={styles.projectCount}>{regularProjects.length}</span>
            </div>
          )}
          {regularProjects.length > 0 ? (
            regularProjects.map(project => renderProject(project, 'project'))
          ) : !collapsed ? (
            <button type="button" className={styles.emptyState} onClick={onCreateProject}>
              <span>{t('segment.projectSidebar.noProjects')}</span>
              <strong>{t('segment.projectSidebar.createProject')}</strong>
            </button>
          ) : null}
        </div>

        {/* P2 v2: 当前项目的源 (项目级资产, 缩起时不显示) */}
        {!collapsed && (
          <div className={styles.section}>
            <div className={styles.sectionLabelRow}>
              <span className={styles.sectionLabel}>{t('segment.projectSidebar.sources')}</span>
              <span className={styles.projectCount}>{activeSources.length}</span>
            </div>
            {activeSources.length > 0 ? (
              <div className={styles.sourceList}>
                {activeSources.map(src => (
                  <div key={src.id} className={styles.sourceItem} title={src.title}>
                    <span className={styles.sourceIcon}>
                      {src.source_type === 'paste' ? '📄' : src.source_type === 'audio' ? '🎵' : '🔗'}
                    </span>
                    <span className={styles.sourceTitle}>{src.title}</span>
                    <span className={styles.sourceBadge}>
                      {src.source_type === 'audio' && src.duration_sec
                        ? formatAudioBadge(src.duration_sec)
                        : src.source_type === 'paste' && src.pasted_text
                          ? t('segment.projectSidebar.pasteText', { count: src.pasted_text.length })
                          : src.source_type}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <button type="button" className={styles.emptyState} onClick={onAddSource}>
                <span>{t('segment.projectSidebar.noSources')}</span>
                <strong>{t('segment.projectSidebar.addFirstSource')}</strong>
              </button>
            )}
            {activeSources.length > 0 && onGenerateNarration && (
              <button type="button" className={styles.narrateBtn} onClick={onGenerateNarration}>
                🧠 {t('segment.projectSidebar.generateNarration', { count: activeSources.length })}
              </button>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
