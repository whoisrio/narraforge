import { useState, useEffect, useCallback, type ReactNode } from 'react';
import { useTranslation, projectNavItems } from '../../i18n';
import type { Chapter } from '../../types';
import { segmentedProjectApi, type ChapterSyncStatus } from '../../services/api';
import { ChapterSyncBadges } from '../SegmentedTTS/ChapterSyncBadges';
import { ChapterSyncModal } from '../SegmentedTTS/ChapterSyncModal';
import styles from './ProjectShell.module.css';


export type ProjectSectionId = 'overview' | 'library' | 'studio' | 'voices' | 'settings';

interface ProjectShellProps {
  projectName: string;
  projectSubtitle?: string;
  projectId?: string;
  activeSection: ProjectSectionId;
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
  onProjectChanged?: () => void;
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
  projectId,
  activeSection,
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
  onProjectChanged,
  rightPanelCollapsed = true,
  children,
  onSectionChange,
  onBackToProjects,
}: ProjectShellProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [editingChapterId, setEditingChapterId] = useState<string | null>(null);
  const [chapterNameDraft, setChapterNameDraft] = useState('');
  const [syncMap, setSyncMap] = useState<Record<string, ChapterSyncStatus>>({});
  const [syncModal, setSyncModal] = useState<{ chapterId: string; status: ChapterSyncStatus } | null>(null);
  const [syncBusy, setSyncBusy] = useState(false);
  const { t } = useTranslation();

  const chapterIds = (chapters ?? []).map((c) => c.id).join(',');
  const isScratchpad = projectId === '__scratchpad__';
  // Fetch sync-status for every chapter when the project or chapter set changes.
  // Skip the scratchpad draft (not backend-persisted; would 404).
  useEffect(() => {
    if (!projectId || isScratchpad || !chapters || chapters.length === 0) return;
    let alive = true;
    Promise.all(
      chapters.map((c) =>
        segmentedProjectApi.getSyncStatus(projectId, c.id).catch(() => null),
      ),
    ).then((results) => {
      if (!alive) return;
      const next: Record<string, ChapterSyncStatus> = {};
      chapters.forEach((c, i) => {
        if (results[i]) next[c.id] = results[i]!;
      });
      setSyncMap(next);
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, chapterIds]);

  // Refresh the active chapter's status when the user switches to it.
  useEffect(() => {
    if (!projectId || isScratchpad || !activeChapterId) return;
    let alive = true;
    segmentedProjectApi
      .getSyncStatus(projectId, activeChapterId)
      .then((st) => { if (alive) setSyncMap((prev) => ({ ...prev, [activeChapterId]: st })); })
      .catch(() => {});
    return () => { alive = false; };
  }, [projectId, activeChapterId]);

  const refetchSyncStatus = useCallback(async (chapterId: string) => {
    if (!projectId) return;
    try {
      const st = await segmentedProjectApi.getSyncStatus(projectId, chapterId);
      setSyncMap((prev) => ({ ...prev, [chapterId]: st }));
    } catch { /* ignore */ }
  }, [projectId]);

  const handleResplit = useCallback(async (chapterId: string) => {
    if (!projectId) return;
    if (!window.confirm(t('sync.resplitDesc'))) return;
    setSyncBusy(true);
    try {
      await segmentedProjectApi.resplitFromScript(projectId, chapterId);
      setSyncModal(null);
      await refetchSyncStatus(chapterId);
      onProjectChanged?.();
    } catch {
      window.alert(t('sync.syncFailed'));
    } finally {
      setSyncBusy(false);
    }
  }, [projectId, t, refetchSyncStatus, onProjectChanged]);

  const handleRewrite = useCallback(async (chapterId: string) => {
    if (!projectId) return;
    setSyncBusy(true);
    try {
      await segmentedProjectApi.rewriteScriptFromSegments(projectId, chapterId);
      setSyncModal(null);
      await refetchSyncStatus(chapterId);
      onProjectChanged?.();
    } catch {
      window.alert(t('sync.syncFailed'));
    } finally {
      setSyncBusy(false);
    }
  }, [projectId, refetchSyncStatus, onProjectChanged]);

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
          {!collapsed && <span>{t('projectShell.backToProjects')}</span>}
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
            <span className={styles.chapterListLabel}>{t('projectShell.chapters')}</span>
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
                        {!collapsed && <ChapterSyncBadges status={syncMap[chapter.id] ?? null} onClick={syncMap[chapter.id] ? () => setSyncModal({ chapterId: chapter.id, status: syncMap[chapter.id] }) : undefined} />}
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
      {syncModal && (
        <ChapterSyncModal
          status={syncModal.status}
          busy={syncBusy}
          onClose={() => setSyncModal(null)}
          onResplit={() => void handleResplit(syncModal.chapterId)}
          onRewrite={() => void handleRewrite(syncModal.chapterId)}
        />
      )}
    </section>
  );
}
