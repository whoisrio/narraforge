import { useState } from 'react';
import type { SegmentedProject } from '../../types';
import styles from './ProjectHub.module.css';

interface ProjectHubProps {
  projects: SegmentedProject[];
  onOpenProject: (projectId: string) => void;
  onCreateProject: () => void;
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

export function ProjectHub({ projects, onOpenProject, onCreateProject, onDeleteProject, onRenameProject }: ProjectHubProps) {
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [openMenuProjectId, setOpenMenuProjectId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
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

  return (
    <section className={styles.root}>
      <header className={styles.hero}>
        <div>
          <span className={styles.kicker}>Projects</span>
          <h1>Project Hub</h1>
          <p>项目总览 · 点击卡片进入项目工作区。</p>
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
          const isEditing = editingProjectId === project.id;
          const isMenuOpen = openMenuProjectId === project.id;
          return (
            <article key={project.id} className={styles.projectCard} aria-label={`项目 ${project.name}`} data-card-variant="compact-project-card">
              <div className={styles.cardHead}>
                {isEditing ? (
                  <div className={styles.cardOpenButton}>
                    <span className={styles.projectInitial}>{projectInitial(project.name)}</span>
                    <span className={styles.cardTitleBlock}>
                      <span className={styles.renameForm}>
                        <label htmlFor={`project-name-${project.id}`}>项目名称</label>
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
                  <span className={styles.projectInitial}>{projectInitial(project.name)}</span>
                  <span className={styles.cardTitleBlock}>
                    <strong>{project.name}</strong>
                    <small>{project.active_narration_version ?? '默认旁白版本'}</small>
                  </span>
                  </button>
                )}
                <span className={styles.statusBadge}>{progress === 100 && stats.segments > 0 ? '完成' : '制作中'}</span>
              </div>
              <div className={styles.cardBody}>
                {isEditing ? (
                  <div className={styles.renameActions}>
                    <button type="button" onClick={() => saveRename(project)}>保存项目名称</button>
                    <button type="button" onClick={() => { setEditingProjectId(null); setRenameDraft(''); }}>取消</button>
                  </div>
                ) : null}
                <div className={styles.cardStats}>
                  <span>{stats.chapters} 章</span>
                  <span>{stats.segments} 段</span>
                  <span>{formatDuration(stats.duration)}</span>
                </div>
                <div className={styles.progressBlock}>
                  <div className={styles.progressCopy}>
                    <span>{stats.generated}/{stats.segments} 已生成</span>
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
                      <div className={styles.actionMenu} role="menu" aria-label={`${project.name} 操作菜单`}>
                        <button type="button" role="menuitem" onClick={() => onOpenProject(project.id)}>打开项目</button>
                        <button type="button" role="menuitem" onClick={() => startRename(project)}>重命名</button>
                        <button
                          type="button"
                          role="menuitem"
                          className={styles.menuDanger}
                          onClick={() => { setOpenMenuProjectId(null); onDeleteProject(project.id); }}
                        >
                          删除项目
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
          <h2>还没有项目</h2>
          <p>先创建一个项目，再进入项目内的文本库和工作室。</p>
        </div>
      )}
    </section>
  );
}
