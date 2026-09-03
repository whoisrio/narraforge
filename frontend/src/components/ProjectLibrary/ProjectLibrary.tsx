import { useMemo, useState } from 'react';
import Markdown from 'react-markdown';
import type { Chapter } from '../../types';
import { useTranslation } from '../../i18n';
import { CompareView } from './CompareView';
import { SourceDocumentView } from './SourceDocumentView';
import { WorkflowDrawer } from '../Workflow/WorkflowDrawer';
import { DrawerIndicator } from '../Workflow/DrawerIndicator';
import { ChapterSplitModal } from './ChapterSplitModal';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { useToast } from '../ui/useToast';
import { useLoading } from '../ui/useLoading';
import { NarrationDocView } from './NarrationDocView';
import { countTextChars, estimateDurationSec, formatSeconds } from './utils';
import { agentClient } from '../../services/langgraph/client';
import { WORKFLOW_KINDS, type WorkflowKind } from '../../services/langgraph/contracts';
import { resolveWorkflowThread } from '../../services/langgraph/threads';
import { segmentedProjectApi, type BatchReuseReport } from '../../services/api';
import { useCapabilities } from '../../hooks/useCapabilities';
import styles from './ProjectLibrary.module.css';

interface ProjectLibraryProps {
  chapters: Chapter[];
  activeChapterId?: string;
  projectId?: string;
  projectName?: string;
  sourceDocument?: string | null;
  narrationScript?: string | null;
  onSelectChapter: (id: string) => void;
  onRenameChapter: (id: string, name: string) => void;
  onRenameProject?: (name: string) => void;
  onUpdateChapterText: (id: string, text: string) => void;
  onUpdateChapterDesignTitle: (id: string, designTitle: string) => void;
  onUpdateSourceDocument?: (text: string) => void;
  onUpdateNarrationScript?: (text: string) => void;
  onAddChapter: (name?: string) => void;
  /** 章节配额已满：禁用新建章节入口（backend 存储 + 普通登录用户 + 已达上限） */
  createChapterDisabled?: boolean;
  /** createChapterDisabled 时新建入口的提示文案 */
  createChapterDisabledHint?: string;
  onDeleteChapter: (id: string) => void;
  onEnterStudio: (chapterId: string) => void;
  onModeChange?: (mode: LibraryMode) => void;
  onProjectChanged?: () => void;
}

/** B1：3 视图 + 章节沉浸编辑器（原 3 tab × 3 mode 导航矩阵的收敛） */
export type LibraryView = 'doc' | 'chapters' | 'source';
export type LibraryMode = LibraryView | 'chapter';

/** 每个 project 记住上次视图（B1）；localStorage 不可用时静默降级为默认 doc */
function viewStorageKey(projectId: string): string {
  return `nf.library.view.${projectId}`;
}

function loadStoredView(projectId?: string): LibraryView {
  if (!projectId) return 'doc';
  try {
    const v = localStorage.getItem(viewStorageKey(projectId));
    return v === 'doc' || v === 'chapters' || v === 'source' ? v : 'doc';
  } catch {
    return 'doc';
  }
}

function storeView(projectId: string | undefined, view: LibraryView): void {
  if (!projectId) return;
  try {
    localStorage.setItem(viewStorageKey(projectId), view);
  } catch {
    /* localStorage 不可用：静默降级 */
  }
}

function chapterText(chapter: Chapter): string {
  return chapter.original_text ?? chapter.segments.map(segment => segment.text).join('\n');
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
  narrationScript,
  onSelectChapter,
  onRenameChapter,
  onUpdateChapterText,
  onUpdateChapterDesignTitle,
  onUpdateSourceDocument,
  onUpdateNarrationScript,
  onAddChapter,
  createChapterDisabled = false,
  createChapterDisabledHint,
  onDeleteChapter,
  onEnterStudio,
  onModeChange,
  onProjectChanged,
}: ProjectLibraryProps) {
  const { t } = useTranslation();
  const { run } = useLoading();
  const { features } = useCapabilities();
  const toast = useToast();
  const [view, setView] = useState<LibraryView>(() => loadStoredView(projectId));
  const [chapterEditorId, setChapterEditorId] = useState<string | null>(null);
  const [comparing, setComparing] = useState(false);
  const [sourceViewMode, setSourceViewMode] = useState<'edit' | 'view'>('edit');
  const [showPreview, setShowPreview] = useState(false);
  const [drawerThreadId, setDrawerThreadId] = useState<string | null>(null);
  const [drawerCollapsed, setDrawerCollapsed] = useState(false);
  const [drawerKind, setDrawerKind] = useState<WorkflowKind>('narration');
  const [splitModal, setSplitModal] = useState<{ fullText: string; diverged: boolean } | null>(null);
  const [splitLoading, setSplitLoading] = useState(false);
  const [splitResult, setSplitResult] = useState<BatchReuseReport | null>(null);

  const joinedChapterText = useMemo(
    () => chapters.map(ch => chapterText(ch)).filter(Boolean).join('\n\n'),
    [chapters],
  );

  const setLibraryView = (next: LibraryView) => {
    setView(next);
    storeView(projectId, next);
    onModeChange?.(next);
  };

  const openChapterEditor = (id: string) => {
    onSelectChapter(id);
    setChapterEditorId(id);
    onModeChange?.('chapter');
  };

  const closeChapterEditor = () => {
    setChapterEditorId(null);
    onModeChange?.(view);
  };

  const openSplitModal = async () => {
    if (!projectId) return;
    setSplitLoading(true);
    // A6：narration_script 是 master。文档（去空白）与章节合并文本不一致时，
    // 弹窗顶部明示「以文档为准，章节侧改动将被覆盖」。
    const squash = (s: string) => s.replace(/\s+/g, '');
    const divergedFrom = (doc: string) =>
      chapters.length > 0 && squash(joinedChapterText) !== '' && squash(doc) !== squash(joinedChapterText);
    try {
      const fromProp = (narrationScript ?? '').trim();
      if (fromProp) { setSplitModal({ fullText: fromProp, diverged: divergedFrom(fromProp) }); return; }
      const detail = await run(t('loading.narrationScript'), async () => {
        return await segmentedProjectApi.getProject(projectId) as unknown as { narration_script?: string | null };
      });
      const fromDetail = (detail.narration_script || '').trim();
      if (fromDetail) { setSplitModal({ fullText: fromDetail, diverged: divergedFrom(fromDetail) }); return; }
      const fallback = joinedChapterText || (sourceDocument ?? '');
      if (fallback.trim()) setSplitModal({ fullText: fallback, diverged: false });
    } catch {
      const fallback = joinedChapterText || (sourceDocument ?? '');
      if (fallback.trim()) setSplitModal({ fullText: fallback, diverged: false });
    } finally {
      setSplitLoading(false);
    }
  };

  const startWorkflow = async (workflowKind: WorkflowKind) => {
    try {
      const binding = WORKFLOW_KINDS[workflowKind];
      // 接管活跃线程；僵尸线程（断连取消、无审批负载）在内部自动清理
      // projectId/projectName 由 TTSSynthesis 固定传入（project.id/project.name），此处仅作非空断言
      const threadId = await resolveWorkflowThread(agentClient, {
        project_id: projectId!,
        project_name: projectName!,
        kind: binding.kind,
      });
      setDrawerKind(workflowKind);
      setDrawerThreadId(threadId);
      setDrawerCollapsed(false);
    } catch (e) {
      console.error('startWorkflow failed', e);
      toast.error('启动工作流失败: ' + (e instanceof Error ? e.message : '未知错误'));
    }
  };

  const [editingChapterId, setEditingChapterId] = useState<string | null>(null);
  const [chapterNameDraft, setChapterNameDraft] = useState('');
  const [creatingChapter, setCreatingChapter] = useState(false);
  const [newChapterName, setNewChapterName] = useState('');
  const editorChapter = chapters.find(chapter => chapter.id === chapterEditorId) ?? null;
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
    if (createChapterDisabled) return;
    onAddChapter(newChapterName.trim() || undefined);
    setNewChapterName('');
    setCreatingChapter(false);
  };

  // ── 章节沉浸编辑器（原 chapter mode 原样保留，B1） ──
  if (editorChapter) {
    const text = chapterText(editorChapter);
    const chars = countTextChars(text);
    const progress = chapterProgress(editorChapter);
    return (
      <section className={styles.chapterEditorRoot}>
        <header className={styles.editorHeader}>
          <h2 className={styles.srOnly}>Immersive Chapter Editor</h2>
          <input
            className={styles.chapterTitleInput}
            aria-label={t('projectLibrary.chapterTitle')}
            value={editorChapter.name}
            onChange={(event) => onRenameChapter(editorChapter.id, event.target.value)}
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
            value={editorChapter.design_title ?? ''}
            onChange={(event) => onUpdateChapterDesignTitle(editorChapter.id, event.target.value)}
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
            aria-label={t("ariaLabels.chapterFullText")}
            value={text}
            onChange={(event) => onUpdateChapterText(editorChapter.id, event.target.value)}
            placeholder={t('projectLibrary.descPlaceholder')}
          />
        )}

        <div className={styles.bottomBar}>
          <button
            type="button"
            className={styles.ghostButton}
            onClick={closeChapterEditor}
          >
            ← {t('projectLibrary.backToLibrary')}
          </button>
          <div className={styles.bottomBarDivider} />
          <button
            type="button"
            className={styles.ghostButton}
            onClick={() => { setChapterEditorId(null); setLibraryView('doc'); }}
          >
            {t('projectLibrary.viewFulltext')}
          </button>
          <button
            type="button"
            className={styles.ghostButton}
            onClick={() => setShowPreview(!showPreview)}
          >
            {showPreview ? t('common.edit') : t('projectLibrary.preview')}
          </button>
          <button
            type="button"
            className={styles.bottomBarNav}
            onClick={() => {
              const nextId = navigateChapter(chapters, editorChapter.id, 'prev');
              onSelectChapter(nextId);
              setChapterEditorId(nextId);
            }}
            aria-label={t('projectLibrary.previousChapter')}
          >
            ← {t('projectLibrary.previousChapter')}
          </button>
          <span className={styles.bottomBarLabel}>{editorChapter.name}</span>
          <button
            type="button"
            className={styles.primaryButton}
            onClick={() => onEnterStudio(editorChapter.id)}
          >
            {t('projectLibrary.enterStudio')}
          </button>
          <button
            type="button"
            className={styles.bottomBarNav}
            onClick={() => {
              const nextId = navigateChapter(chapters, editorChapter.id, 'next');
              onSelectChapter(nextId);
              setChapterEditorId(nextId);
            }}
            aria-label={t('projectLibrary.nextChapter')}
          >
            {t('projectLibrary.nextChapter')} →
          </button>
        </div>
      </section>
    );
  }

  const chaptersContent = chapters.length === 0 ? (
    <div className={styles.emptyRoot}>
      <span className={styles.kicker}>{t('projectLibrary.title')}</span>
      <h2>{t('projectLibrary.title')}</h2>
      <p>{t('projectLibrary.emptyDesc')}</p>
      <button
        type="button"
        onClick={() => onAddChapter()}
        disabled={createChapterDisabled}
        title={createChapterDisabled ? createChapterDisabledHint : undefined}
      >{t('projectLibrary.newChapter')}</button>
    </div>
  ) : (
    <>
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
            <button
              type="button"
              onClick={createChapter}
              disabled={createChapterDisabled}
              title={createChapterDisabled ? createChapterDisabledHint : undefined}
            >{t('projectLibrary.createChapter')}</button>
            <button type="button" onClick={() => { setCreatingChapter(false); setNewChapterName(''); }}>{t('common.cancel')}</button>
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
                aria-current={chapter.id === activeChapterId ? 'page' : undefined}
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
                        <button type="button" onClick={() => saveChapterName(chapter)}>{t('common.save')}</button>
                        <button type="button" onClick={() => { setEditingChapterId(null); setChapterNameDraft(''); }}>{t('common.cancel')}</button>
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
                  <button type="button" onClick={() => openChapterEditor(chapter.id)}>{t('projectLibrary.openText')}</button>
                  <button type="button" onClick={() => onEnterStudio(chapter.id)}>{t('projectLibrary.enterStudio')}</button>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </>
  );

  // B5：拆分结果反馈（留在 doc 视图 + 「查看章节」主动跳转）
  const splitDiscard = splitResult?.discard;
  const splitDiscardTotal = (splitDiscard?.text_changed ?? 0) + (splitDiscard?.boundary_changed ?? 0);
  const splitResultMessage = splitResult ? (
    <>
      <p>{t('chapterSplit.reuseReport', {
        reused: splitResult.segments_reused,
        fresh: splitResult.segments_new,
      })}</p>
      {splitDiscardTotal > 0 && (
        <p>{t('chapterSplit.confirmDiscard', {
          total: splitDiscardTotal,
          textChanged: splitDiscard?.text_changed ?? 0,
          boundaryChanged: splitDiscard?.boundary_changed ?? 0,
        })}</p>
      )}
      {(splitResult.recorded_discard ?? 0) > 0 && (
        <p>{t('chapterSplit.confirmRecorded', { count: splitResult.recorded_discard ?? 0 })}</p>
      )}
    </>
  ) : '';

  const VIEW_KEYS: { id: LibraryView; key: string }[] = [
    { id: 'doc', key: 'projectLibrary.viewDoc' },
    { id: 'chapters', key: 'projectLibrary.viewChapters' },
    { id: 'source', key: 'projectLibrary.viewSource' },
  ];

  return (
    <section className={styles.root}>
      <header className={styles.libraryHeader}>
        <div>
          <div className={styles.tabBar}>
            {VIEW_KEYS.map(({ id, key }) => (
              <button
                key={id}
                type="button"
                className={`${styles.tab} ${view === id ? styles.tabActive : ''}`}
                onClick={() => { setComparing(false); setLibraryView(id); }}
              >
                {t(key)}
              </button>
            ))}
          </div>
        </div>
        <div className={styles.headerActions}>
          {view === 'chapters' && (
            <>
              <div className={styles.headerStat}><span>{t('projectLibrary.chapterCount')}</span><strong>{chapters.length}</strong></div>
              <div className={styles.headerStat}><span>{t('projectLibrary.wordCount')}</span><strong>{totals.chars}</strong></div>
              <div className={styles.headerStat}><span>{t('projectLibrary.segments')}</span><strong>{totals.segments}</strong></div>
              <button
                type="button"
                className={styles.primaryButton}
                onClick={() => setCreatingChapter(true)}
                disabled={createChapterDisabled}
                title={createChapterDisabled ? createChapterDisabledHint : undefined}
              >{t('projectLibrary.newChapter')}</button>
            </>
          )}
          {view === 'source' && !comparing && (
            <>
              <button
                type="button"
                className={styles.ghostButton}
                onClick={() => setSourceViewMode(sourceViewMode === 'edit' ? 'view' : 'edit')}
              >
                {sourceViewMode === 'edit' ? t('projectLibrary.view') : t('common.edit')}
              </button>
              <button type="button" className={styles.ghostButton} onClick={() => setComparing(true)}>{t('projectLibrary.compare')}</button>
            </>
          )}
        </div>
      </header>

      <div className={styles.scrollContent}>
        {view === 'doc' && (
          <NarrationDocView
            narrationScript={narrationScript ?? null}
            joinedChapterText={joinedChapterText}
            chapterCount={chapters.length}
            onUpdateNarrationScript={(text) => onUpdateNarrationScript?.(text)}
            onSplit={() => void openSplitModal()}
            onGoToSource={() => setLibraryView('source')}
          />
        )}
        {view === 'chapters' && chaptersContent}
        {view === 'source' && (
          comparing ? (
            <CompareView
              sourceDocument={sourceDocument ?? ''}
              narrationText={chapters.map(ch => chapterText(ch)).filter(Boolean).join('\n\n')}
              onBack={() => setComparing(false)}
            />
          ) : (
            <>
              <SourceDocumentView
                content={sourceDocument ?? ''}
                onChange={(text) => onUpdateSourceDocument?.(text)}
                onCompare={() => setComparing(true)}
                onBack={() => setLibraryView('doc')}
                viewMode={sourceViewMode}
                onViewModeChange={setSourceViewMode}
              />
              {projectId && features.agent_workflow && (
                <div className={styles.workflowTrigger}>
                  <div>
                    <strong>从源文档启动工作流</strong>
                    <span>旁白：改写 → 审查 → 拆分 → 合成；知识视频：转写 → 审查 → 拆分 → 合成 → Remotion 工程 → 分镜 brief</span>
                  </div>
                  <button className={styles.workflowBtn} onClick={() => startWorkflow('narration')}>
                    <span className="material-symbols-outlined">auto_awesome</span>
                    生成旁白
                  </button>
                  <button className={styles.workflowBtn} onClick={() => startWorkflow('knowledge_video')}>
                    <span className="material-symbols-outlined">movie</span>
                    知识视频
                  </button>
                </div>
              )}
            </>
          )
        )}
      </div>
      {drawerThreadId && !drawerCollapsed && projectId && features.agent_workflow && (
        <WorkflowDrawer
          threadId={drawerThreadId}
          projectId={projectId}
          assistantId={WORKFLOW_KINDS[drawerKind].assistantId}
          onClose={() => setDrawerThreadId(null)}
          onCollapse={() => setDrawerCollapsed(true)}
        />
      )}
      {drawerThreadId && drawerCollapsed && features.agent_workflow && (
        <DrawerIndicator
          status="running"
          onExpand={() => setDrawerCollapsed(false)}
        />
      )}
      {splitModal && projectId && (
        <ChapterSplitModal
          projectId={projectId}
          fullText={splitModal.fullText}
          existingChapterCount={chapters.length}
          divergenceWarning={splitModal.diverged}
          onClose={() => setSplitModal(null)}
          onApplied={(reuse) => {
            setSplitModal(null);
            onProjectChanged?.();
            // B5：留在 doc 视图，结果反馈附「查看章节」主动跳转
            if (reuse) setSplitResult(reuse);
          }}
        />
      )}
      <ConfirmDialog
        open={splitResult !== null}
        title={t('chapterSplit.resultTitle')}
        message={splitResultMessage}
        confirmLabel={t('chapterSplit.viewChapters')}
        cancelLabel={t('chapterSplit.stayInDoc')}
        variant="warning"
        onConfirm={() => { setSplitResult(null); setLibraryView('chapters'); }}
        onCancel={() => setSplitResult(null)}
      />
      {splitLoading && <span className={styles.srOnly}>{t('chapterSplit.detecting')}</span>}
    </section>
  );
}
