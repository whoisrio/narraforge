import type { ReactNode } from 'react';
import { createTranslator, projectNavItems, type Locale } from '../../i18n';
import styles from './ProjectShell.module.css';

export type ProjectSectionId = 'overview' | 'library' | 'studio' | 'voices' | 'settings';

interface ProjectShellProps {
  projectName: string;
  projectSubtitle?: string;
  activeSection: ProjectSectionId;
  locale?: Locale;
  chapterName?: string;
  segmentCount?: number;
  generatedCount?: number;
  durationSec?: number;
  children: ReactNode;
  onSectionChange: (section: ProjectSectionId) => void;
  onBackToProjects?: () => void;
}

const SECTION_ICONS: Record<ProjectSectionId, string> = {
  overview: '◇',
  library: '▤',
  studio: '◉',
  voices: '◌',
  settings: '⚙',
};

function formatDuration(totalSec: number): string {
  const safe = Math.max(0, Math.round(totalSec));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function ProjectShell({
  projectName,
  projectSubtitle,
  activeSection,
  locale = 'zh-CN',
  chapterName = '未选择章节',
  segmentCount = 0,
  generatedCount = 0,
  durationSec = 0,
  children,
  onSectionChange,
  onBackToProjects,
}: ProjectShellProps) {
  const t = createTranslator(locale);

  return (
    <section className={styles.root} data-testid="project-shell" data-sidebar="fixed-left" data-workspace-chrome="breadcrumb-only">
      <aside className={styles.projectRail} aria-label="Project navigation">
        <div className={styles.projectIdentity}>
          <div className={styles.projectMark}>{projectName.slice(0, 1) || 'N'}</div>
          <div className={styles.projectTextBlock}>
            <h2 title={projectName}>{projectName}</h2>
            {projectSubtitle && <p title={projectSubtitle}>{projectSubtitle}</p>}
          </div>
        </div>

        <button
          type="button"
          className={styles.backToProjects}
          onClick={onBackToProjects}
        >
          <span>←</span>
          <span>返回项目总览</span>
        </button>

        <nav className={styles.projectNav}>
          {projectNavItems.map(item => {
            const id = item.id as ProjectSectionId;
            const active = id === activeSection;
            return (
              <button
                key={item.id}
                type="button"
                className={`${styles.projectNavItem} ${active ? styles.projectNavItemActive : ''}`}
                aria-current={active ? 'page' : undefined}
                onClick={() => onSectionChange(id)}
              >
                <span className={styles.projectNavIcon}>{SECTION_ICONS[id]}</span>
                <span>{t(item.labelKey)}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      <div className={styles.workspace}>
        <div className={styles.contextBar} aria-label="Project workspace context">
          <div className={styles.breadcrumbs}>
            <span>{projectName}</span>
            <span>/</span>
            <strong>{t(`projectNav.${activeSection}`)}</strong>
            <span className={styles.inlineMeta}>/ {chapterName} · {segmentCount} 段 · {generatedCount} 已生成 · {formatDuration(durationSec)}</span>
          </div>
        </div>

        <div className={styles.workspaceBody}>{children}</div>
      </div>
    </section>
  );
}
