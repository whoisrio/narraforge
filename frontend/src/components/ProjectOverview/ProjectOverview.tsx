import type { Chapter } from '../../types';
import styles from './ProjectOverview.module.css';

interface ProjectOverviewProps {
  projectName: string;
  chapters: Chapter[];
  activeChapterId?: string;
  defaultNarratorName?: string | null;
  remotionPath?: string | null;
  onEnterLibrary: () => void;
  onEnterStudio: () => void;
  onOpenVoices: () => void;
  onOpenSettings: () => void;
}

function formatDuration(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(safe / 60);
  const rest = safe % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

function estimateWords(chapter: Chapter): number {
  const source = chapter.original_text || chapter.segments.map(segment => segment.text).join('');
  return source.replace(/\s+/g, '').length;
}

export function ProjectOverview({
  projectName,
  chapters,
  activeChapterId,
  defaultNarratorName,
  remotionPath,
  onEnterLibrary,
  onEnterStudio,
  onOpenVoices,
  onOpenSettings,
}: ProjectOverviewProps) {
  const activeChapter = chapters.find(chapter => chapter.id === activeChapterId) ?? chapters[0];
  const segmentCount = chapters.reduce((sum, chapter) => sum + chapter.segments.length, 0);
  const generatedCount = chapters.reduce((sum, chapter) => sum + chapter.segments.filter(segment => segment.status === 'ready').length, 0);
  const durationSec = chapters.reduce((sum, chapter) => sum + chapter.segments.reduce((inner, segment) => inner + (segment.duration_sec ?? 0), 0), 0);
  const progress = segmentCount === 0 ? 0 : Math.round((generatedCount / segmentCount) * 100);

  return (
    <section className={styles.root}>
      <header className={styles.header}>
        <div>
          <span className={styles.kicker}>Project Overview</span>
          <h2>{projectName}</h2>
          <p>从文本库、声音角色到工作室生产的项目状态总览。</p>
        </div>
        <div className={styles.actions}>
          <button type="button" onClick={onEnterLibrary}>打开文本库</button>
          <button type="button" className={styles.primary} onClick={onEnterStudio}>进入工作室</button>
        </div>
      </header>

      <div className={styles.metrics}>
        <div><span>章节</span><strong>{chapters.length} 章</strong></div>
        <div><span>分段</span><strong>{segmentCount} 段</strong></div>
        <div><span>完成</span><strong>{generatedCount} 已生成</strong></div>
        <div><span>时长</span><strong>{formatDuration(durationSec)}</strong></div>
      </div>

      <div className={styles.grid}>
        <article className={styles.mainCard}>
          <div className={styles.cardHeader}>
            <span className={styles.kicker}>Active Chapter</span>
            <strong>{activeChapter?.design_title || activeChapter?.name || '暂无章节'}</strong>
          </div>
          <p>{activeChapter?.original_text || activeChapter?.segments.map(segment => segment.text).join(' ') || '还没有章节正文。打开文本库开始整理章节全文。'}</p>
          <div className={styles.progressRow}>
            <span>{progress}%</span>
            <div className={styles.track}><i style={{ width: `${progress}%` }} /></div>
          </div>
        </article>

        <aside className={styles.sideStack}>
          <section className={styles.sideCard}>
            <span className={styles.kicker}>Voice Role</span>
            <strong>{defaultNarratorName || '未设置默认旁白'}</strong>
            <p>旁白角色决定 narration 段的默认声音。</p>
            <button type="button" onClick={onOpenVoices}>配置声音角色</button>
          </section>
          <section className={styles.sideCard}>
            <span className={styles.kicker}>Remotion Target</span>
            <strong>{remotionPath || '未设置 Remotion 路径'}</strong>
            <p>导出会优先写入 Remotion 项目的 public/audio。</p>
            <button type="button" onClick={onOpenSettings}>项目设置</button>
          </section>
        </aside>
      </div>

      <div className={styles.chapterStrip}>
        {chapters.map((chapter, index) => (
          <article key={chapter.id} className={`${styles.chapterCard} ${chapter.id === activeChapterId ? styles.active : ''}`}>
            <span>CH {String(index + 1).padStart(2, '0')}</span>
            <strong>{chapter.design_title || chapter.name}</strong>
            <small>{estimateWords(chapter)} 字 · {chapter.segments.length} 段 · {chapter.segments.filter(segment => segment.status === 'ready').length} 已生成</small>
          </article>
        ))}
      </div>
    </section>
  );
}
