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
  return (
    <aside className={`${styles.sidebar} ${collapsed ? styles.sidebarCollapsed : ''}`}>
      <div className={styles.header}>
        {!collapsed && (
          <div>
            <div className={styles.eyebrow}>项目库</div>
            <h2 className={styles.title}>配音工作台</h2>
          </div>
        )}
        <button
          type="button"
          className={styles.collapseButton}
          onClick={onToggleCollapse}
          aria-label={collapsed ? '展开项目侧栏' : '收起项目侧栏'}
          title={collapsed ? '展开项目侧栏' : '收起项目侧栏'}
        >
          {collapsed ? '›' : '‹'}
        </button>
      </div>

      <button
        type="button"
        className={styles.newProjectButton}
        onClick={onCreateProject}
        title="新建项目"
      >
        <span className={styles.newProjectIcon}>+</span>
        {!collapsed && <span>新建项目</span>}
      </button>

      <div className={styles.projectList}>
        {projects.map((project) => {
          const isScratchpad = project.id === scratchpadId;
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
                <span className={styles.projectIcon}>{isScratchpad ? '✦' : '文'}</span>
                {!collapsed && (
                  <span className={styles.projectBody}>
                    <span className={styles.projectTopline}>
                      <span className={styles.projectName}>{project.name}</span>
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
        })}
      </div>
    </aside>
  );
}
