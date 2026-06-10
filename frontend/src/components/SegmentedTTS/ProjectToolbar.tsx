import type { SegmentedProject } from '../../types';
import styles from './ProjectToolbar.module.css';

interface ProjectToolbarProps {
  project: SegmentedProject;
  onRename: (name: string) => void;
  onLayoutToggle: () => void;
  onGenerateAll: () => void;
  onAnnotateAll: () => void;
  onExport: () => void;
}

export function ProjectToolbar({ project, onRename, onExport, onLayoutToggle, onGenerateAll, onAnnotateAll }: ProjectToolbarProps) {
  const allSegments = project.chapters.flatMap(c => c.segments);
  const numSegments = allSegments.length;
  const totalDuration = allSegments.reduce((acc: number, s) => acc + (s.duration_sec ?? 0), 0);
  const readyCount = allSegments.filter((s) => s.status === 'ready').length;

  return (
    <div className={styles.toolbar}>
      <input className={styles.nameInput} value={project.name}
        onChange={(e) => onRename(e.target.value)} />
      <span className={styles.stats}>
        {numSegments} 段 · {totalDuration.toFixed(1)}s
        {readyCount > 0 && ` · ${readyCount}/${numSegments} 已生成`}
      </span>
      <div className={styles.actions}>
        <button className={styles.actionBtn} onClick={onGenerateAll} title="全部生成">⚡ 全部生成</button>
        <button className={styles.actionBtn} onClick={onAnnotateAll} title="全部智能标注 SSML">✨ 标注</button>
        <button className={styles.actionBtn} onClick={onExport} title="导出">⬇ 导出</button>
        <button className={styles.actionBtn} onClick={onLayoutToggle}>
          {project.layout === 'vertical' ? '⇄ 横向' : '⇅ 纵向'}
        </button>
      </div>
    </div>
  );
}
