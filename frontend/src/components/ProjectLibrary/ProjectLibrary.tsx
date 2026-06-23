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

function chapterDuration(chapter: Chapter): number {
  return chapter.segments.reduce((total, segment) => total + (segment.duration_sec ?? 0), 0);
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
  const activeChapter = chapters.find(chapter => chapter.id === activeChapterId) ?? chapters[0];
  const activeText = activeChapter?.original_text ?? activeChapter?.segments.map(segment => segment.text).join('\n') ?? '';
  const charCount = countTextChars(activeText);
  const estimated = estimateDurationSec(activeText);
  const readyCount = activeChapter?.segments.filter(segment => segment.status === 'ready').length ?? 0;

  if (!activeChapter) {
    return (
      <section className={styles.emptyRoot}>
        <h2>文本库</h2>
        <p>还没有章节。先创建一个章节，再进入工作室分段合成。</p>
        <button type="button" onClick={onAddChapter}>新建章节</button>
      </section>
    );
  }

  return (
    <section className={styles.root}>
      <aside className={styles.chapterList}>
        <div className={styles.listHeader}>
          <div>
            <span className={styles.kicker}>Library</span>
            <h2>章节文本</h2>
          </div>
          <button type="button" className={styles.addButton} onClick={onAddChapter}>新建章节</button>
        </div>

        <div className={styles.chapterItems}>
          {chapters.map((chapter, index) => {
            const text = chapter.original_text ?? chapter.segments.map(segment => segment.text).join('\n');
            const selected = chapter.id === activeChapter.id;
            return (
              <button
                key={chapter.id}
                type="button"
                className={`${styles.chapterItem} ${selected ? styles.chapterItemActive : ''}`}
                aria-current={selected ? 'page' : undefined}
                onClick={() => onSelectChapter(chapter.id)}
              >
                <span className={styles.chapterIndex}>{String(index + 1).padStart(2, '0')}</span>
                <span className={styles.chapterMeta}>
                  <strong>{chapter.name}</strong>
                  <small>{countTextChars(text)} 字 · {chapter.segments.length} 段 · {formatSeconds(chapterDuration(chapter))}</small>
                </span>
              </button>
            );
          })}
        </div>
      </aside>

      <main className={styles.editorPane}>
        <div className={styles.editorHeader}>
          <div className={styles.titleGroup}>
            <label htmlFor="chapter-title">章节标题</label>
            <input
              id="chapter-title"
              value={activeChapter.name}
              onChange={(event) => onRenameChapter(activeChapter.id, event.target.value)}
            />
          </div>
          <button type="button" className={styles.enterStudioButton} onClick={() => onEnterStudio(activeChapter.id)}>
            进入工作室
          </button>
        </div>

        <div className={styles.metrics}>
          <div><span>字数</span><strong>{charCount} 字</strong></div>
          <div><span>预计</span><strong>预计 {estimated.toFixed(1)}s</strong></div>
          <div><span>分段</span><strong>{activeChapter.segments.length} 段</strong></div>
          <div><span>已生成</span><strong>{readyCount}/{activeChapter.segments.length}</strong></div>
        </div>

        <label className={styles.textEditorLabel} htmlFor="chapter-full-text">章节全文</label>
        <textarea
          id="chapter-full-text"
          className={styles.textEditor}
          value={activeText}
          onChange={(event) => onUpdateChapterText(activeChapter.id, event.target.value)}
          placeholder="在这里维护本章完整旁白稿。进入工作室后再切分为语音段落。"
        />
      </main>
    </section>
  );
}
