import { useMemo, useState } from 'react';
import type { Chapter } from '../../types';
import styles from './ProjectLibrary.module.css';

interface ProjectLibraryProps {
  chapters: Chapter[];
  activeChapterId?: string;
  onSelectChapter: (id: string) => void;
  onRenameChapter: (id: string, name: string) => void;
  onUpdateChapterText: (id: string, text: string) => void;
  onAddChapter: () => void;
  onEnterStudio: (chapterId: string) => void;
}

type LibraryMode = 'overview' | 'chapter';

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

export function ProjectLibrary({
  chapters,
  activeChapterId,
  onSelectChapter,
  onRenameChapter,
  onUpdateChapterText,
  onAddChapter,
  onEnterStudio,
}: ProjectLibraryProps) {
  const [mode, setMode] = useState<LibraryMode>('overview');
  const activeChapter = chapters.find(chapter => chapter.id === activeChapterId) ?? chapters[0];
  const totals = useMemo(() => {
    const chars = chapters.reduce((sum, chapter) => sum + countTextChars(chapterText(chapter)), 0);
    const segments = chapters.reduce((sum, chapter) => sum + chapter.segments.length, 0);
    const ready = chapters.reduce((sum, chapter) => sum + chapterProgress(chapter).ready, 0);
    return { chars, segments, ready };
  }, [chapters]);

  if (!activeChapter) {
    return (
      <section className={styles.emptyRoot}>
        <span className={styles.kicker}>Library</span>
        <h2>Chapter Library</h2>
        <p>还没有章节。先创建一个章节，再进入工作室分段合成。</p>
        <button type="button" onClick={onAddChapter}>新建章节</button>
      </section>
    );
  }

  if (mode === 'chapter') {
    const text = chapterText(activeChapter);
    const chars = countTextChars(text);
    const progress = chapterProgress(activeChapter);
    return (
      <section className={styles.chapterEditorRoot}>
        <main className={styles.writingCanvas}>
          <div className={styles.chapterToolbar}>
            <button type="button" className={styles.ghostButton} onClick={() => setMode('overview')}>返回文本库</button>
            <button type="button" className={styles.primaryButton} onClick={() => onEnterStudio(activeChapter.id)}>进入工作室</button>
          </div>

          <span className={styles.kicker}>Immersive Chapter Editor</span>
          <label className={styles.chapterTitleLabel} htmlFor="library-chapter-title">章节标题</label>
          <input
            id="library-chapter-title"
            className={styles.chapterTitleInput}
            value={activeChapter.name}
            onChange={(event) => onRenameChapter(activeChapter.id, event.target.value)}
          />

          <div className={styles.editorMetrics}>
            <span>{chars} 字</span>
            <span>预计 {formatSeconds(estimateDurationSec(text))}</span>
            <span>{progress.ready}/{progress.total} 已生成</span>
          </div>

          <label className={styles.textEditorLabel} htmlFor="library-chapter-full-text">章节全文</label>
          <textarea
            id="library-chapter-full-text"
            className={styles.manuscriptEditor}
            value={text}
            onChange={(event) => onUpdateChapterText(activeChapter.id, event.target.value)}
            placeholder="在这里维护本章完整旁白稿。进入工作室后再切分为语音段落。"
          />
        </main>

        <aside className={styles.inspectorPanel}>
          <h3>章节信息</h3>
          <div className={styles.inspectorCard}>
            <span>设计标题</span>
            <strong>{activeChapter.design_title || activeChapter.name}</strong>
          </div>
          <div className={styles.inspectorCard}>
            <span>分段状态</span>
            <strong>{progress.ready}/{progress.total} 已生成</strong>
          </div>
          <div className={styles.inspectorCard}>
            <span>音频时长</span>
            <strong>{formatSeconds(chapterAudioDuration(activeChapter))}</strong>
          </div>
          <p className={styles.inspectorHint}>文本库负责章节全文；进入工作室后再进行切分、配音、试听与导出。</p>
        </aside>
      </section>
    );
  }

  return (
    <section className={styles.root}>
      <header className={styles.libraryHeader}>
        <div>
          <span className={styles.kicker}>Library</span>
          <h2>Chapter Library</h2>
          <p>管理每个章节的整体旁白文本。打开文本进行沉浸式编辑，或直接进入工作室合成。</p>
        </div>
        <div className={styles.headerActions}>
          <div className={styles.headerStat}><span>章节</span><strong>{chapters.length}</strong></div>
          <div className={styles.headerStat}><span>字数</span><strong>{totals.chars}</strong></div>
          <div className={styles.headerStat}><span>分段</span><strong>{totals.segments}</strong></div>
          <button type="button" className={styles.primaryButton} onClick={onAddChapter}>新建章节</button>
        </div>
      </header>

      <div className={styles.filterRow}>
        <span className={styles.filterChipActive}>Active <strong>{chapters.length}</strong></span>
        <span className={styles.filterChip}>Drafts</span>
        <span className={styles.filterChip}>Completed <strong>{totals.ready}</strong></span>
      </div>

      <div className={styles.chapterGrid}>
        {chapters.map((chapter, index) => {
          const text = chapterText(chapter);
          const chars = countTextChars(text);
          const progress = chapterProgress(chapter);
          return (
            <article key={chapter.id} className={styles.chapterCard}>
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
                <h3>{chapter.name}</h3>
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
                  <button type="button" onClick={() => { onSelectChapter(chapter.id); setMode('chapter'); }}>打开文本</button>
                  <button type="button" onClick={() => onEnterStudio(chapter.id)}>进入工作室</button>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
