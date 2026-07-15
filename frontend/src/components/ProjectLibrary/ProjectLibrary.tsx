import { useMemo, useState } from 'react';
import Markdown from 'react-markdown';
import type { Chapter } from '../../types';
import { useTranslation } from '../../i18n';
import { CompareView } from './CompareView';
import { SourceDocumentView } from './SourceDocumentView';
import { WorkflowDrawer } from '../Workflow/WorkflowDrawer';
import { DrawerIndicator } from '../Workflow/DrawerIndicator';
import { agentClient } from '../../services/langgraph/client';
import styles from './ProjectLibrary.module.css';

interface ProjectLibraryProps {
  chapters: Chapter[];
  activeChapterId?: string;
  projectId?: string;
  projectName?: string;
  sourceDocument?: string | null;
  onSelectChapter: (id: string) => void;
  onRenameChapter: (id: string, name: string) => void;
  onRenameProject?: (name: string) => void;
  onUpdateChapterText: (id: string, text: string) => void;
  onUpdateChapterDesignTitle: (id: string, designTitle: string) => void;
  onUpdateSourceDocument?: (text: string) => void;
  onAddChapter: (name?: string) => void;
  onDeleteChapter: (id: string) => void;
  onEnterStudio: (chapterId: string) => void;
  onModeChange?: (mode: 'overview' | 'chapter' | 'fulltext') => void;
}

type LibraryMode = 'overview' | 'chapter' | 'fulltext';
type LibraryTab = 'source' | 'narration';

function chapterText(chapter: Chapter): string {
  return chapter.original_text ?? chapter.segments.map(segment => segment.text).join('\n');
}

function countTextChars(text: string): number {
  return text.replace(/\s/g, '').length;
}

function estimateDurationSec(text: string): number {
  return countTextChars(text) / 5;
}

function formatSeconds(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes}m ${rest}s`;
}

function chapterAudioDuration(chapter: Chapter): number {
  return chapter.segments.reduce((total, segment) => total + (segment.audio.duration_sec ?? 0), 0);
}

function chapterProgress(chapter: Chapter) {
  const total = chapter.segments.length;
  const ready = chapter.segments.filter(segment => segment.status === 'ready').length;
  return { total, ready, percent: total === 0 ? 0 : Math.round((ready / total) * 100) };
}

function initialForChapter(chapter: Chapter): string {
  return chapter.name.trim().slice(0, 1) || '章';
}

function navigateChapter(chapters: Chapter[], currentId: string, direction: 'prev' | 'next'): string {
  const idx = chapters.findIndex(c => c.id === currentId);
  if (idx < 0) return chapters[0]?.id ?? currentId;
  const len = chapters.length;
  const nextIdx = direction === 'next' ? (idx + 1) % len : (idx - 1 + len) % len;
  return chapters[nextIdx].id;
}

export function ProjectLibrary({
  chapters,
  activeChapterId,
  projectId,
  projectName,
  sourceDocument,
  onSelectChapter,
  onRenameChapter,
  onUpdateChapterText,
  onUpdateChapterDesignTitle,
  onUpdateSourceDocument,
  onAddChapter,
  onDeleteChapter,
  onEnterStudio,
  onModeChange,
}: ProjectLibraryProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<LibraryMode>('overview');
  const [activeTab, setActiveTab] = useState<LibraryTab>('narration');
  const [comparing, setComparing] = useState(false);
  const [sourceViewMode, setSourceViewMode] = useState<'edit' | 'view'>('edit');
  const [showPreview, setShowPreview] = useState(false);
  const [drawerThreadId, setDrawerThreadId] = useState<string | null>(null);
  const [drawerCollapsed, setDrawerCollapsed] = useState(false);

  const startWorkflow = async () => {
    try {
      const existing = await agentClient.threads.search({
        metadata: { project_id: projectId, kind: 'narration_workflow' },
        limit: 50,
      });
      const active = existing.filter(
        (t: any) => t.status === 'busy' || t.status === 'interrupted',
      );
      if (active.length) {
        setDrawerThreadId(active[0].thread_id);
        setDrawerCollapsed(false);
        return;
      }
      const thread = await agentClient.threads.create({
        metadata: {
          project_id: projectId,
          project_name: projectName,
          kind: 'narration_workflow',
        },
      });
      setDrawerThreadId(thread.thread_id);
      setDrawerCollapsed(false);
    } catch (e: any) {
      console.error('startWorkflow failed', e);
      alert('启动工作流失败: ' + (e.message || '未知错误'));
    }
  };

  const setLibraryMode = (next: LibraryMode) => {
    setMode(next);
    onModeChange?.(next);
  };
  const [editingChapterId, setEditingChapterId] = useState<string | null>(null);
  const [chapterNameDraft, setChapterNameDraft] = useState('');
  const [creatingChapter, setCreatingChapter] = useState(false);
  const [newChapterName, setNewChapterName] = useState('');
  const activeChapter = chapters.find(chapter => chapter.id === activeChapterId) ?? chapters[0];
  const canDeleteChapter = chapters.length > 1;
  const totals = useMemo(() => {
    const chars = chapters.reduce((sum, chapter) => sum + countTextChars(chapterText(chapter)), 0);
    const segments = chapters.reduce((sum, chapter) => sum + chapter.segments.length, 0);
    const ready = chapters.reduce((sum, chapter) => sum + chapterProgress(chapter).ready, 0);
    return { chars, segments, ready };
  }, [chapters]);

  const startRenameChapter = (chapter: Chapter) => {
    setEditingChapterId(chapter.id);
    setChapterNameDraft(chapter.name);
  };

  const saveChapterName = (chapter: Chapter) => {
    const nextName = chapterNameDraft.trim();
    if (!nextName) {
      setEditingChapterId(null);
      setChapterNameDraft('');
      return;
    }
    if (nextName !== chapter.name) {
      onRenameChapter(chapter.id, nextName);
    }
    setEditingChapterId(null);
    setChapterNameDraft('');
  };

  const createChapter = () => {
    onAddChapter(newChapterName.trim() || undefined);
    setNewChapterName('');
    setCreatingChapter(false);
  };

  if (!activeChapter) {
    return (
      <section className={styles.emptyRoot}>
        <span className={styles.kicker}>{t('projectLibrary.title')}</span>
        <h2>{t('projectLibrary.title')}</h2>
        <p>{t('projectLibrary.emptyDesc')}</p>
        <button type="button" onClick={() => onAddChapter()}>{t('projectLibrary.newChapter')}</button>
      </section>
    );
  }

  if (mode === 'chapter') {
    const text = chapterText(activeChapter);
    const chars = countTextChars(text);
    const progress = chapterProgress(activeChapter);
    return (
      <section className={styles.chapterEditorRoot}>
        <header className={styles.editorHeader}>
          <h2 className={styles.srOnly}>Immersive Chapter Editor</h2>
          <input
            className={styles.chapterTitleInput}
            aria-label={t('projectLibrary.chapterTitle')}
            value={activeChapter.name}
            onChange={(event) => onRenameChapter(activeChapter.id, event.target.value)}
            placeholder={t('projectLibrary.chapterTitle')}
          />
          <div className={styles.editorMetrics}>
            <span>{chars} {t('projectLibrary.wordCount')}</span>
            <span>{t('projectLibrary.estimated')} {formatSeconds(estimateDurationSec(text))}</span>
            <span>{progress.ready}/{progress.total} {t('projectLibrary.segmentsGenerated')}</span>
          </div>
        </header>

        <label className={styles.designTitleField}>
          <span>{t('projectLibrary.designTitle')}</span>
          <input
            value={activeChapter.design_title ?? ''}
            onChange={(event) => onUpdateChapterDesignTitle(activeChapter.id, event.target.value)}
            placeholder={t('projectLibrary.designTitlePlaceholder')}
          />
        </label>

        {showPreview ? (
          <div className={styles.markdownPreview}>
            <Markdown>{text || `*${t('projectLibrary.noContent')}*`}</Markdown>
          </div>
        ) : (
          <textarea
            className={styles.manuscriptEditor}
            aria-label="章节全文"
            value={text}
            onChange={(event) => onUpdateChapterText(activeChapter.id, event.target.value)}
            placeholder={t('projectLibrary.descPlaceholder')}
          />
        )}

        <div className={styles.bottomBar}>
          <button
            type="button"
            className={styles.ghostButton}
            onClick={() => setLibraryMode('overview')}
          >
            ← {t('projectLibrary.backToLibrary')}
          </button>
          <div className={styles.bottomBarDivider} />
          <button
            type="button"
            className={styles.ghostButton}
            onClick={() => setLibraryMode('fulltext')}
          >
            {t('projectLibrary.viewFulltext')}
          </button>
          <button
            type="button"
            className={styles.ghostButton}
            onClick={() => setShowPreview(!showPreview)}
          >
            {showPreview ? t('projectLibrary.edit') : t('projectLibrary.preview')}
          </button>
          <button
            type="button"
            className={styles.bottomBarNav}
            onClick={() => onSelectChapter(navigateChapter(chapters, activeChapter.id, 'prev'))}
            aria-label={t('projectLibrary.previousChapter')}
          >
            ← {t('projectLibrary.previousChapter')}
          </button>
          <span className={styles.bottomBarLabel}>{activeChapter.name}</span>
          <button
            type="button"
            className={styles.primaryButton}
            onClick={() => onEnterStudio(activeChapter.id)}
          >
            {t('projectLibrary.enterStudio')}
          </button>
          <button
            type="button"
            className={styles.bottomBarNav}
            onClick={() => onSelectChapter(navigateChapter(chapters, activeChapter.id, 'next'))}
            aria-label={t('projectLibrary.nextChapter')}
          >
            {t('projectLibrary.nextChapter')} →
          </button>
        </div>
      </section>
    );
  }

  if (mode === 'fulltext') {
    const allText = chapters.map(ch => chapterText(ch)).filter(Boolean).join('\n\n');
    const allChars = countTextChars(allText);
    const allDuration = estimateDurationSec(allText);
    return (
      <section className={styles.chapterEditorRoot}>
        <header className={styles.editorHeader}>
          <h2 className={styles.chapterTitleInput} style={{ border: 'none', background: 'none', cursor: 'default' }}>{t('projectLibrary.fulltextView')}</h2>
          <div className={styles.editorMetrics}>
            <span>{allChars} {t('projectLibrary.wordCount')}</span>
            <span>{t('projectLibrary.estimated')} {formatSeconds(allDuration)}</span>
            <span>{chapters.length} {t('projectLibrary.chapterCount')}</span>
          </div>
        </header>

        <div className={styles.markdownPreview}>
          <Markdown>{allText || `*${t('projectLibrary.noContent')}*`}</Markdown>
        </div>

        <div className={styles.bottomBar}>
          <button
            type="button"
            className={styles.ghostButton}
            onClick={() => setLibraryMode('overview')}
          >
            ← {t('projectLibrary.backToLibrary')}
          </button>
          <div className={styles.bottomBarDivider} />
          <button
            type="button"
            className={styles.ghostButton}
            onClick={() => {
              if (activeChapter) {
                onSelectChapter(activeChapter.id);
                setLibraryMode('chapter');
              }
            }}
          >
            {t('projectLibrary.viewByChapter')}
          </button>
        </div>
      </section>
    );
  }

  const narrationContent = (
    <>
      <div className={styles.filterRow}>
        <span className={styles.filterChipActive}>{t('projectLibrary.active')} <strong>{chapters.length}</strong></span>
        <span className={styles.filterChip}>{t('projectLibrary.draft')}</span>
        <span className={styles.filterChip}>{t('projectLibrary.completed')} <strong>{totals.ready}</strong></span>
      </div>

      {creatingChapter && (
        <div className={styles.createChapterPanel}>
          <label htmlFor="library-new-chapter-name">{t('projectLibrary.chapterName')}</label>
          <input
            id="library-new-chapter-name"
            value={newChapterName}
            placeholder={`${t('projectLibrary.newChapterPlaceholder')} ${chapters.length + 1}`}
            onChange={(event) => setNewChapterName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') createChapter();
              if (event.key === 'Escape') {
                setCreatingChapter(false);
                setNewChapterName('');
              }
            }}
            autoFocus
          />
          <div className={styles.createChapterActions}>
            <button type="button" onClick={createChapter}>{t('projectLibrary.createChapter')}</button>
            <button type="button" onClick={() => { setCreatingChapter(false); setNewChapterName(''); }}>{t('projectLibrary.cancel')}</button>
          </div>
        </div>
      )}

      <div className={styles.chapterGrid}>
        {chapters.map((chapter, index) => {
          const text = chapterText(chapter);
          const chars = countTextChars(text);
          const progress = chapterProgress(chapter);
          const isEditing = editingChapterId === chapter.id;
          return (
            <article key={chapter.id} className={styles.chapterCard} data-chapter-card="compact">
              <button
                type="button"
                className={styles.chapterCover}
                aria-current={chapter.id === activeChapter.id ? 'page' : undefined}
                aria-label={`选择${chapter.name}`}
                onClick={() => onSelectChapter(chapter.id)}
              >
                <span className={styles.chapterInitial}>{initialForChapter(chapter)}</span>
                <span className={styles.chapterBadge}>CH {String(index + 1).padStart(2, '0')}</span>
              </button>
              <div className={styles.chapterBody}>
                <div className={styles.chapterTitleRow}>
                  {isEditing ? (
                    <div className={styles.chapterRenameForm}>
                      <label htmlFor={`chapter-card-name-${chapter.id}`}>{t('projectLibrary.chapterTitle')}</label>
                      <input
                        id={`chapter-card-name-${chapter.id}`}
                        value={chapterNameDraft}
                        onChange={(event) => setChapterNameDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') saveChapterName(chapter);
                          if (event.key === 'Escape') {
                            setEditingChapterId(null);
                            setChapterNameDraft('');
                          }
                        }}
                        autoFocus
                      />
                      <div className={styles.chapterRenameActions}>
                        <button type="button" onClick={() => saveChapterName(chapter)}>{t('projectLibrary.save')}</button>
                        <button type="button" onClick={() => { setEditingChapterId(null); setChapterNameDraft(''); }}>{t('projectLibrary.cancel')}</button>
                      </div>
                    </div>
                  ) : (
                    <h3>{chapter.name}</h3>
                  )}
                  {!isEditing && (
                    <div className={styles.chapterQuickActions}>
                      <button type="button" aria-label={`${t('projectLibrary.renameChapter')} ${chapter.name}`} onClick={() => startRenameChapter(chapter)}>✎</button>
                      <button type="button" aria-label={`${t('projectLibrary.deleteChapter')} ${chapter.name}`} disabled={!canDeleteChapter} onClick={() => onDeleteChapter(chapter.id)}>⌫</button>
                    </div>
                  )}
                </div>
                <p>{text || t('projectLibrary.noContent')}</p>
                <div className={styles.chapterStats}>
                  <span>{chars} {t('projectLibrary.chars')}</span>
                  <span>{chapter.segments.length} {t('projectLibrary.segments')}</span>
                  <span>{formatSeconds(chapterAudioDuration(chapter))}</span>
                </div>
                <div className={styles.progressMeta}>
                  <span>{t('projectLibrary.generationProgress')}</span>
                  <span>{progress.ready}/{progress.total} {t('projectLibrary.segmentsGenerated')}</span>
                </div>
                <div className={styles.progressTrack}><span style={{ width: `${progress.percent}%` }} /></div>
                <div className={styles.cardActions}>
                  <button type="button" onClick={() => { onSelectChapter(chapter.id); setLibraryMode('chapter'); }}>{t('projectLibrary.openText')}</button>
                  <button type="button" onClick={() => onEnterStudio(chapter.id)}>{t('projectLibrary.enterStudio')}</button>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </>
  );

  return (
    <section className={styles.root}>
      <header className={styles.libraryHeader}>
        <div>
          {/* {activeTab === 'source' ? (
            <input
              className={styles.sourceTitleInput}
              value={projectName ?? ''}
              onChange={(e) => onRenameProject?.(e.target.value)}
              placeholder="源文档标题"
            />
          ) : (
            <h2>文本库</h2>
          )} */}
          <div className={styles.tabBar}>
            <button
              type="button"
              className={`${styles.tab} ${activeTab === 'source' ? styles.tabActive : ''}`}
              onClick={() => { setActiveTab('source'); setComparing(false); }}
            >
              {t('projectLibrary.sourceDoc')}
            </button>
            <button
              type="button"
              className={`${styles.tab} ${activeTab === 'narration' ? styles.tabActive : ''}`}
              onClick={() => { setActiveTab('narration'); setComparing(false); }}
            >
              {t('projectLibrary.narrationDoc')}
            </button>
          </div>
        </div>
        <div className={styles.headerActions}>
          {activeTab === 'source' && !comparing && (
            <>
              <button
                type="button"
                className={styles.ghostButton}
                onClick={() => setSourceViewMode(sourceViewMode === 'edit' ? 'view' : 'edit')}
              >
                {sourceViewMode === 'edit' ? t('projectLibrary.view') : t('projectLibrary.edit')}
              </button>
              <button type="button" className={styles.ghostButton} onClick={() => setComparing(true)}>{t('projectLibrary.compare') || '对比'}</button>
              <button type="button" className={styles.ghostButton} onClick={() => setActiveTab('narration')}>← {t('projectLibrary.backToLibrary')}</button>
            </>
          )}
          {activeTab === 'narration' && !comparing && (
            <>
              <div className={styles.headerStat}><span>{t('projectLibrary.chapterCount')}</span><strong>{chapters.length}</strong></div>
              <div className={styles.headerStat}><span>{t('projectLibrary.wordCount')}</span><strong>{totals.chars}</strong></div>
              <div className={styles.headerStat}><span>{t('projectLibrary.segments')}</span><strong>{totals.segments}</strong></div>
              <button type="button" className={styles.ghostButton} onClick={() => setLibraryMode('fulltext')}>{t('projectLibrary.viewFulltext')}</button>
              <button type="button" className={styles.primaryButton} onClick={() => setCreatingChapter(true)}>{t('projectLibrary.newChapter')}</button>
            </>
          )}
        </div>
      </header>

      <div className={styles.scrollContent}>
        {comparing ? (
          <CompareView
            sourceDocument={sourceDocument ?? ''}
            narrationText={chapters.map(ch => chapterText(ch)).filter(Boolean).join('\n\n')}
            onBack={() => setComparing(false)}
          />
        ) : activeTab === 'source' ? (
          <>
            <SourceDocumentView
              content={sourceDocument ?? ''}
              onChange={(text) => onUpdateSourceDocument?.(text)}
              onCompare={() => setComparing(true)}
              onBack={() => setActiveTab('narration')}
              viewMode={sourceViewMode}
              onViewModeChange={setSourceViewMode}
            />
            {projectId && (
              <div className={styles.workflowTrigger}>
                <div>
                  <strong>从此源文档生成旁白</strong>
                  <span>运行 4 阶段工作流：生成脚本 → 脚本审查 → 段落拆分 → 语音合成</span>
                </div>
                <button className={styles.workflowBtn} onClick={startWorkflow}>
                  <span className="material-symbols-outlined">auto_awesome</span>
                  生成旁白
                </button>
              </div>
            )}
          </>
        ) : (
          narrationContent
        )}
      </div>
      {drawerThreadId && !drawerCollapsed && projectId && (
                  <WorkflowDrawer
            threadId={drawerThreadId}
            projectId={projectId}
            onClose={() => setDrawerThreadId(null)}
            onCollapse={() => setDrawerCollapsed(true)}
          />
              )}
      {drawerThreadId && drawerCollapsed && (
                  <DrawerIndicator
            status="running"
            onExpand={() => setDrawerCollapsed(false)}
          />
              )}
    </section>
  );
}
