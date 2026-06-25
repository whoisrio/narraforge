import { useState, type ReactNode } from 'react';
import { createTranslator, projectNavItems, type Locale } from '../../i18n';
import type { Chapter } from '../../types';
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
  chapters?: Chapter[];
  activeChapterId?: string;
  onSelectChapter?: (chapterId: string) => void;
  onAddChapter?: () => void;
  onRenameChapter?: (chapterId: string, name: string) => void;
  onDeleteChapter?: (chapterId: string) => void;
  rightPanelCollapsed?: boolean;
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
  chapters,
  activeChapterId,
  onSelectChapter,
  onAddChapter,
  onRenameChapter,
  onDeleteChapter,
  rightPanelCollapsed = true,
  children,
  onSectionChange,
  onBackToProjects,
}: ProjectShellProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [editingChapterId, setEditingChapterId] = useState<string | null>(null);
  const [chapterNameDraft, setChapterNameDraft] = useState('');
  const t = createTranslator(locale);

  const startRename = (chapter: Chapter) => {
    setEditingChapterId(chapter.id);
    setChapterNameDraft(chapter.name);
  };

  const saveRename = (chapter: Chapter) => {
    const nextName = chapterNameDraft.trim();
    if (nextName && nextName !== chapter.name) {
      onRenameChapter?.(chapter.id, nextName);
    }
    setEditingChapterId(null);
    setChapterNameDraft('');
  };

  return (
    <section className={styles.root} data-testid="project-shell" data-sidebar="fixed-left" data-workspace-chrome="breadcrumb-only" data-collapsed={collapsed ? 'true' : 'false'}>
      <aside className={styles.projectRail} aria-label="Project navigation">
        <div className={styles.projectIdentity}>
          <div className={styles.projectMark}>{projectName.slice(0, 1) || 'N'}</div>
          {!collapsed && <div className={styles.projectTextBlock}>
            <h2 title={projectName}>{projectName}</h2>
            {projectSubtitle && <p title={projectSubtitle}>{projectSubtitle}</p>}
          </div>}
        </div>

        <button
          type="button"
          className={styles.backToProjects}
          onClick={onBackToProjects}
        >
          <span>←</span>
          {!collapsed && <span>返回项目总览</span>}
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
                aria-label={collapsed ? t(item.labelKey) : undefined}
                title={collapsed ? t(item.labelKey) : undefined}
                onClick={() => onSectionChange(id)}
              >
                <span className={styles.projectNavIcon}>{SECTION_ICONS[id]}</span>
                {!collapsed && <span>{t(item.labelKey)}</span>}
              </button>
            );
          })}
        </nav>

        {(activeSection === 'library' || activeSection === 'studio') && chapters && chapters.length > 0 && (
          <div className={styles.chapterListSection}>
            <span className={styles.chapterListLabel}>Chapters</span>
            <ul className={styles.chapterList}>
              {chapters.map((chapter, index) => (
                <li key={chapter.id} className={styles.chapterListItemWrap}>
                  {editingChapterId === chapter.id ? (
                    <div className={styles.chapterRenameInline}>
                      <input
                        className={styles.chapterRenameInput}
                        value={chapterNameDraft}
                        onChange={(e) => setChapterNameDraft(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') saveRename(chapter); if (e.key === 'Escape') { setEditingChapterId(null); setChapterNameDraft(''); } }}
                        autoFocus
                      />
                      <button type="button" className={styles.chapterRenameSave} onClick={() => saveRename(chapter)}>✓</button>
                    </div>
                  ) : (
                    <div
                      className={`${styles.chapterListItem} ${chapter.id === activeChapterId ? styles.chapterListItemActive : ''}`}
                      data-chapter-card="compact"
                    >
                      <button
                        type="button"
                        className={styles.chapterListSelect}
                        aria-label={`选择章节 ${chapter.name}`}
                        onClick={() => onSelectChapter?.(chapter.id)}
                      >
                        <span className={styles.chapterListIndex}>{String(index + 1).padStart(2, '0')}</span>
                        {!collapsed && <span className={styles.chapterListName}>{chapter.name}</span>}
                      </button>
                      {!collapsed && (
                        <span className={styles.chapterItemActions}>
                          <button
                            type="button"
                            className={styles.chapterItemAction}
                            aria-label={`重命名 ${chapter.name}`}
                            onClick={() => startRename(chapter)}
                          >✎</button>
                          {chapters.length > 1 && (
                            <button
                              type="button"
                              className={styles.chapterItemActionDanger}
                              aria-label={`删除 ${chapter.name}`}
                              onClick={() => onDeleteChapter?.(chapter.id)}
                            >⌫</button>
                          )}
                        </span>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
            {onAddChapter && (
              <button type="button" className={styles.newChapterBtn} onClick={onAddChapter}>
                {!collapsed ? '+ 新建章节' : '+'}
              </button>
            )}
          </div>
        )}

        <button
          type="button"
          className={styles.collapseButton}
          aria-label={collapsed ? '展开项目导航' : '收起项目导航'}
          onClick={() => setCollapsed(value => !value)}
        >
          <span>{collapsed ? '›' : '‹'}</span>
          {!collapsed && <span>收起</span>}
        </button>
      </aside>

      <div className={styles.workspace} data-right-panel-collapsed={rightPanelCollapsed ? 'true' : 'false'}>
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
