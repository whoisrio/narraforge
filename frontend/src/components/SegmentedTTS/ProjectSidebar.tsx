import type { SegmentedProject } from '../../types';
import styles from './ProjectSidebar.module.css';

interface ProjectSidebarProps {
  projects: SegmentedProject[];
  activeProjectId: string;
  collapsed: boolean;
  scratchpadId: string;
  onToggleCollapse: () => void;
  onSelectProject: (projectId: string) => void;
  onCreateProject: () => void;
  onDeleteProject: (projectId: string) => void;
}

function getProjectStats(project: SegmentedProject) {
  const segments = project.chapters.reduce((sum, chapter) => sum + chapter.segments.length, 0);
  const ready = project.chapters.reduce(
    (sum, chapter) => sum + chapter.segments.filter(segment => segment.status === 'ready').length,
    0,
  );
  const duration = project.chapters.reduce(
    (sum, chapter) => sum + chapter.segments.reduce((chapterSum, segment) => chapterSum + (segment.duration_sec ?? 0), 0),
    0,
  );

  return { segments, ready, duration };
}

function formatDuration(seconds: number) {
  if (seconds <= 0) return '0s';
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes}m ${rest}s`;
}

export function ProjectSidebar({
  projects,
  activeProjectId,
  collapsed,
  scratchpadId,
  onToggleCollapse,
  onSelectProject,
  onCreateProject,
  onDeleteProject,
}: ProjectSidebarProps) {
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
          <span className={styles.projectIcon}>{isScratchpad ? '草' : '稿'}</span>
          {!collapsed && (
            <span className={styles.projectBody}>
              <span className={styles.projectTopline}>
                <span className={styles.projectName}>{project.name}</span>
                {isScratchpad && <span className={styles.pinBadge}>默认</span>}
              </span>
              <span className={styles.projectMeta}>
                {stats.segments} 段 · {stats.ready}/{stats.segments} 已生成 · {formatDuration(stats.duration)}
              </span>
            </span>
          )}
        </button>
        {!collapsed && !isScratchpad && (
          <button
            type="button"
            className={styles.deleteButton}
            title="删除项目"
            aria-label={`删除项目 ${project.name}`}
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
            <div className={styles.eyebrow}>Projects</div>
            <h2 className={styles.title}>项目</h2>
          </div>
        )}
        <div className={styles.headerActions}>
          <button
            type="button"
            className={styles.iconButton}
            onClick={onCreateProject}
            aria-label="新建项目"
            title="新建项目"
          >
            +
          </button>
          <button
            type="button"
            className={styles.iconButton}
            onClick={onToggleCollapse}
            aria-label={collapsed ? '展开项目侧栏' : '收起项目侧栏'}
            title={collapsed ? '展开项目侧栏' : '收起项目侧栏'}
          >
            {collapsed ? '›' : '‹'}
          </button>
        </div>
      </div>

      <div className={styles.projectList}>
        {scratchpad && (
          <div className={styles.section}>
            {!collapsed && <div className={styles.sectionLabel}>草稿</div>}
            {renderProject(scratchpad, 'scratchpad')}
          </div>
        )}

        <div className={styles.section}>
          {!collapsed && (
            <div className={styles.sectionLabelRow}>
              <span className={styles.sectionLabel}>项目</span>
              <span className={styles.projectCount}>{regularProjects.length}</span>
            </div>
          )}
          {regularProjects.length > 0 ? (
            regularProjects.map(project => renderProject(project, 'project'))
          ) : !collapsed ? (
            <button type="button" className={styles.emptyState} onClick={onCreateProject}>
              <span>还没有正式项目</span>
              <strong>创建一个项目 →</strong>
            </button>
          ) : null}
        </div>
      </div>
    </aside>
  );
}
