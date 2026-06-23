import type { SegmentedProject } from '../../types';
import styles from './ProjectHub.module.css';

interface ProjectHubProps {
  projects: SegmentedProject[];
  onOpenProject: (projectId: string) => void;
  onCreateProject: () => void;
}

function projectStats(project: SegmentedProject) {
  const chapters = project.chapters.length;
  const segments = project.chapters.reduce((total, chapter) => total + chapter.segments.length, 0);
  const generated = project.chapters.reduce(
    (total, chapter) => total + chapter.segments.filter(segment => segment.status === 'ready').length,
    0,
  );
  const duration = project.chapters.reduce(
    (total, chapter) => total + chapter.segments.reduce((sum, segment) => sum + (segment.duration_sec ?? 0), 0),
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

export function ProjectHub({ projects, onOpenProject, onCreateProject }: ProjectHubProps) {
  const totalSegments = projects.reduce((total, project) => total + projectStats(project).segments, 0);
  const totalGenerated = projects.reduce((total, project) => total + projectStats(project).generated, 0);

  return (
    <section className={styles.root}>
      <header className={styles.hero}>
        <div>
          <span className={styles.kicker}>Projects</span>
          <h1>Project Hub</h1>
          <p>从这里进入项目。全局项目页只展示项目总览；点击项目卡片后才进入文本库、工作室、声音角色和项目设置。</p>
        </div>
        <div className={styles.heroStats}>
          <div><span>项目</span><strong>{projects.length}</strong></div>
          <div><span>分段</span><strong>{totalSegments}</strong></div>
          <div><span>已生成</span><strong>{totalGenerated}</strong></div>
        </div>
      </header>

      <div className={styles.grid}>
        <button type="button" className={styles.createCard} onClick={onCreateProject}>
          <span className={styles.createIcon}>+</span>
          <strong>新建项目</strong>
          <small>创建新的旁白项目</small>
        </button>

        {projects.map(project => {
          const stats = projectStats(project);
          const progress = stats.segments === 0 ? 0 : Math.round((stats.generated / stats.segments) * 100);
          return (
            <button
              key={project.id}
              type="button"
              className={styles.projectCard}
              onClick={() => onOpenProject(project.id)}
            >
              <div className={styles.cardCover}>
                <span className={styles.projectInitial}>{projectInitial(project.name)}</span>
                <span className={styles.statusBadge}>{progress === 100 && stats.segments > 0 ? 'READY' : 'IN PROGRESS'}</span>
              </div>
              <div className={styles.cardBody}>
                <h2>{project.name}</h2>
                <p>{project.active_narration_version ?? '默认旁白版本'}</p>
                <div className={styles.cardStats}>
                  <span>{stats.chapters} 章</span>
                  <span>{stats.segments} 段</span>
                  <span>{formatDuration(stats.duration)}</span>
                </div>
                <div className={styles.progressTrack}>
                  <span style={{ width: `${progress}%` }} />
                </div>
                <small>{stats.generated}/{stats.segments} 已生成</small>
              </div>
            </button>
          );
        })}
      </div>

      {projects.length === 0 && (
        <div className={styles.emptyState}>
          <h2>还没有项目</h2>
          <p>先创建一个项目，再进入项目内的文本库和工作室。</p>
        </div>
      )}
    </section>
  );
}
