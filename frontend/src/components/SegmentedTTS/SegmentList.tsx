import type { Segment } from '../../types';
import { SegmentRow } from './SegmentRow';
import styles from './SegmentList.module.css';

interface SegmentListProps {
  segments: Segment[];
  layout: 'vertical' | 'horizontal';
  selectedId?: string;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onInsertAfter: (afterId: string) => void;
  onAppend: () => void;
  onReorder: (from: number, to: number) => void;
  onEdit: (id: string) => void;
  onRegenerate: (id: string) => void;
  onUndo: (id: string) => void;
  onAnnotateSSML?: (id: string) => void;
}

export function SegmentList(props: SegmentListProps) {
  const { segments, layout, selectedId, onAppend } = props;

  if (layout === 'horizontal') {
    return (
      <div className={styles.horizontalContainer}>
        {segments.map((seg) => (
          <SegmentRow key={seg.id} segment={seg} isSelected={seg.id === selectedId}
            layout="horizontal" {...props} />
        ))}
        <button className={styles.appendBtnHoriz} onClick={onAppend}>+</button>
      </div>
    );
  }

  return (
    <div className={styles.verticalContainer}>
      {segments.map((seg) => (
        <SegmentRow key={seg.id} segment={seg} isSelected={seg.id === selectedId}
          layout="vertical" {...props} />
      ))}
      <button className={styles.appendBtn} onClick={onAppend}>+ 追加新段</button>
    </div>
  );
}
