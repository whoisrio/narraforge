import { useMemo, useState } from 'react';
import Markdown from 'react-markdown';
import type { Chapter } from '../../types';
import { CompareView } from './CompareView';
import { SourceDocumentView } from './SourceDocumentView';
import styles from './ProjectLibrary.module.css';

interface ProjectLibraryProps {
  chapters: Chapter[];
  activeChapterId?: string;
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
  return chapter.segments.reduce((total, segment) => total + (segment.duration_sec ?? 0), 0);
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
  projectName,
  onRenameProject,
}: ProjectLibraryProps) {
  const [mode, setMode] = useState<LibraryMode>('overview');
  const [activeTab, setActiveTab] = useState<LibraryTab>('narration');
  const [comparing, setComparing] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

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
        <span className={styles.kicker}>Library</span>
        <h2>Chapter Library</h2>
        <p>还没有章节。先创建一个章节，再进入工作室分段合成。</p>
        <button type="button" onClick={() => onAddChapter()}>新建章节</button>
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
            aria-label="章节标题"
            value={activeChapter.name}
            onChange={(event) => onRenameChapter(activeChapter.id, event.target.value)}
            placeholder="章节标题"
          />
          <div className={styles.editorMetrics}>
            <span>{chars} 字</span>
            <span>预计 {formatSeconds(estimateDurationSec(text))}</span>
            <span>{progress.ready}/{progress.total} 已生成</span>
          </div>
        </header>

        <label className={styles.designTitleField}>
          <span>设计标题</span>
          <input
            value={activeChapter.design_title ?? ''}
            onChange={(event) => onUpdateChapterDesignTitle(activeChapter.id, event.target.value)}
            placeholder="用于视频画面的章节标题"
          />
        </label>

        {showPreview ? (
          <div className={styles.markdownPreview}>
            <Markdown>{text || '*尚未填写章节全文。*'}</Markdown>
          </div>
        ) : (
          <textarea
            className={styles.manuscriptEditor}
            aria-label="章节全文"
            value={text}
            onChange={(event) => onUpdateChapterText(activeChapter.id, event.target.value)}
            placeholder="在这里维护本章完整旁白稿。进入工作室后再切分为语音段落。"
          />
        )}

        <div className={styles.bottomBar}>
          <button
            type="button"
            className={styles.ghostButton}
            onClick={() => setLibraryMode('overview')}
          >
            ← 返回文本库
          </button>
          <div className={styles.bottomBarDivider} />
          <button
            type="button"
            className={styles.ghostButton}
            onClick={() => setLibraryMode('fulltext')}
          >
            查看全文
          </button>
          <button
            type="button"
            className={styles.ghostButton}
            onClick={() => setShowPreview(!showPreview)}
          >
            {showPreview ? '编辑' : '预览'}
          </button>
          <button
            type="button"
            className={styles.bottomBarNav}
            onClick={() => onSelectChapter(navigateChapter(chapters, activeChapter.id, 'prev'))}
            aria-label="上一章"
          >
            ← 上一章
          </button>
          <span className={styles.bottomBarLabel}>{activeChapter.name}</span>
          <button
            type="button"
            className={styles.primaryButton}
            onClick={() => onEnterStudio(activeChapter.id)}
          >
            进入工作室
          </button>
          <button
            type="button"
            className={styles.bottomBarNav}
            onClick={() => onSelectChapter(navigateChapter(chapters, activeChapter.id, 'next'))}
            aria-label="下一章"
          >
            下一章 →
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
          <h2 className={styles.chapterTitleInput} style={{ border: 'none', background: 'none', cursor: 'default' }}>文本库全文</h2>
          <div className={styles.editorMetrics}>
            <span>{allChars} 字</span>
            <span>预计 {formatSeconds(allDuration)}</span>
            <span>{chapters.length} 章</span>
          </div>
        </header>

        <div className={styles.markdownPreview}>
          <Markdown>{allText || '*尚未填写任何章节全文。*'}</Markdown>
        </div>

        <div className={styles.bottomBar}>
          <button
            type="button"
            className={styles.ghostButton}
            onClick={() => setLibraryMode('overview')}
          >
            ← 返回文本库
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
            按章节查看
          </button>
        </div>
      </section>
    );
  }

  const narrationContent = (
    <>
      <div className={styles.filterRow}>
        <span className={styles.filterChipActive}>Active <strong>{chapters.length}</strong></span>
        <span className={styles.filterChip}>Drafts</span>
        <span className={styles.filterChip}>Completed <strong>{totals.ready}</strong></span>
      </div>

      {creatingChapter && (
        <div className={styles.createChapterPanel}>
          <label htmlFor="library-new-chapter-name">新章节名称</label>
          <input
            id="library-new-chapter-name"
            value={newChapterName}
            placeholder={`新章节 ${chapters.length + 1}`}
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
            <button type="button" onClick={createChapter}>创建章节</button>
            <button type="button" onClick={() => { setCreatingChapter(false); setNewChapterName(''); }}>取消</button>
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
                      <label htmlFor={`chapter-card-name-${chapter.id}`}>章节卡片名称</label>
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
                        <button type="button" onClick={() => saveChapterName(chapter)}>保存章节名称</button>
                        <button type="button" onClick={() => { setEditingChapterId(null); setChapterNameDraft(''); }}>取消</button>
                      </div>
                    </div>
                  ) : (
                    <h3>{chapter.name}</h3>
                  )}
                  {!isEditing && (
                    <div className={styles.chapterQuickActions}>
                      <button type="button" aria-label={`重命名章节 ${chapter.name}`} onClick={() => startRenameChapter(chapter)}>✎</button>
                      <button type="button" aria-label={`删除章节 ${chapter.name}`} disabled={!canDeleteChapter} onClick={() => onDeleteChapter(chapter.id)}>⌫</button>
                    </div>
                  )}
                </div>
                <p>{text || '尚未填写章节全文。'}</p>
                <div className={styles.chapterStats}>
                  <span>{chars} 字</span>
                  <span>{chapter.segments.length} 段</span>
                  <span>{formatSeconds(chapterAudioDuration(chapter))}</span>
                </div>
                <div className={styles.progressMeta}>
                  <span>生成进度</span>
                  <span>{progress.ready}/{progress.total} 已生成</span>
                </div>
                <div className={styles.progressTrack}><span style={{ width: `${progress.percent}%` }} /></div>
                <div className={styles.cardActions}>
                  <button type="button" onClick={() => { onSelectChapter(chapter.id); setLibraryMode('chapter'); }}>打开文本</button>
                  <button type="button" onClick={() => onEnterStudio(chapter.id)}>进入工作室</button>
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
          {activeTab === 'source' ? (
            <input
              className={styles.sourceTitleInput}
              value={projectName ?? ''}
              onChange={(e) => onRenameProject?.(e.target.value)}
              placeholder="源文档标题"
            />
          ) : (
            <h2>文本库</h2>
          )}
          <div className={styles.tabBar}>
            <button
              type="button"
              className={`${styles.tab} ${activeTab === 'source' ? styles.tabActive : ''}`}
              onClick={() => { setActiveTab('source'); setComparing(false); }}
            >
              源文档
            </button>
            <button
              type="button"
              className={`${styles.tab} ${activeTab === 'narration' ? styles.tabActive : ''}`}
              onClick={() => { setActiveTab('narration'); setComparing(false); }}
            >
              旁白文档
            </button>
          </div>
        </div>
        {activeTab === 'narration' && !comparing && (
          <div className={styles.headerActions}>
            <div className={styles.headerStat}><span>章节</span><strong>{chapters.length}</strong></div>
            <div className={styles.headerStat}><span>字数</span><strong>{totals.chars}</strong></div>
            <div className={styles.headerStat}><span>分段</span><strong>{totals.segments}</strong></div>
            <button type="button" className={styles.ghostButton} onClick={() => setLibraryMode('fulltext')}>查看全文</button>
            <button type="button" className={styles.primaryButton} onClick={() => setCreatingChapter(true)}>新建章节</button>
          </div>
        )}
      </header>

      {comparing ? (
        <CompareView
          sourceDocument={sourceDocument ?? ''}
          narrationText={chapters.map(ch => chapterText(ch)).filter(Boolean).join('\n\n')}
          onBack={() => setComparing(false)}
        />
      ) : activeTab === 'source' ? (
        <SourceDocumentView
          content={sourceDocument ?? ''}
          onChange={(text) => onUpdateSourceDocument?.(text)}
          onCompare={() => setComparing(true)}
          onBack={() => setActiveTab('narration')}
        />
      ) : (
        narrationContent
      )}
    </section>
  );
}
