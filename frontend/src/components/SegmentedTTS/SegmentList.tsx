import type { Segment, SegmentEngineParams, VoiceProfile } from '../../types';
import { SegmentRow } from './SegmentRow';
import { SegmentEditPanel } from './SegmentEditPanel';
import styles from './SegmentList.module.css';

interface SegmentListProps {
  segments: Segment[];
  layout: 'vertical' | 'horizontal';
  selectedId?: string;
  playingId?: string;
  isPaused?: boolean;
  compact?: boolean;
  voices: VoiceProfile[];
  globalVoiceId?: string;
  globalVoiceName?: string;
  globalEdgeVoice?: string;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onInsertAfter: (afterId: string) => void;
  onAppend: () => void;
  onReorder: (from: number, to: number) => void;
  onEdit: (id: string) => void;
  onRegenerate: (id: string) => void;
  onPlay: (id: string) => void;
  onTrimSilence?: (id: string) => void;
  onUndo: (id: string) => void;
  onAnnotateSSML?: (id: string) => void;
  onDuplicate?: (id: string) => void;
  onUpdateText?: (id: string, text: string) => void;
  onUpdateSSML?: (id: string, ssml: string) => void;
  onUpdateParams?: (id: string, params: Partial<SegmentEngineParams>) => void;
  onUpdateEmotion?: (id: string, emotion: string) => void;
  onToggleIndependentVoice?: (id: string) => void;
}

export function SegmentList(props: SegmentListProps) {
  const { segments, layout, selectedId, playingId, isPaused, compact, voices, globalVoiceId, globalVoiceName, globalEdgeVoice, onAppend, onEdit, onPlay } = props;

  // Compute cumulative time ranges for each segment
  const timeRanges: { start: number; end?: number }[] = [];
  let cumulative = 0;
  for (const seg of segments) {
    const start = cumulative;
    if (seg.duration_sec && seg.status === 'ready') {
      cumulative += seg.duration_sec;
      timeRanges.push({ start, end: cumulative });
    } else {
      timeRanges.push({ start });
    }
  }

  const rowProps = (seg: Segment, i: number) => ({
    segment: seg, index: i + 1, isSelected: seg.id === selectedId,
    isPlaying: seg.id === playingId, isPaused: !!(isPaused && seg.id === playingId),
    compact, voices, globalVoiceId, globalVoiceName, globalEdgeVoice,
    timeStart: timeRanges[i]?.start, timeEnd: timeRanges[i]?.end,
    onSelect: props.onSelect, onDelete: props.onDelete,
    onInsertAfter: props.onInsertAfter, onEdit: onEdit,
    onRegenerate: props.onRegenerate, onPlay: onPlay, onTrimSilence: props.onTrimSilence, onUndo: props.onUndo,
    onAnnotateSSML: props.onAnnotateSSML, onDuplicate: props.onDuplicate,
    onToggleIndependentVoice: props.onToggleIndependentVoice,
  });

  if (layout === 'horizontal') {
    return (
      <div className={styles.horizontalContainer}>
        {segments.map((seg, i) => (
          <SegmentRow key={seg.id} {...rowProps(seg, i)} layout="horizontal" />
        ))}
        <button className={styles.appendBtnHoriz} onClick={onAppend}>+</button>
      </div>
    );
  }

  const editingSegment = segments.find(s => s.id === selectedId) ?? null;

  return (
    <div className={styles.verticalContainer}>
      {segments.map((seg, i) => {
        const isEditing = seg.id === selectedId;
        return (
          <div key={seg.id} className={styles.segmentGroup}>
            <SegmentRow {...rowProps(seg, i)} layout="vertical" />
            {isEditing && editingSegment && (
              <div className={styles.accordionWrapper}>
                <SegmentEditPanel
                  segment={editingSegment}
                  globalVoiceName={props.globalVoiceName}
                  onClose={() => onEdit('')}
                  onUpdateText={props.onUpdateText || (() => {})}
                  onUpdateSSML={props.onUpdateSSML || (() => {})}
                  onUpdateParams={props.onUpdateParams || (() => {})}
                  onUpdateEmotion={props.onUpdateEmotion}
                  onRegenerate={props.onRegenerate}
                  onAnnotateSSML={(id) => props.onAnnotateSSML?.(id)}
                />
              </div>
            )}
            {/* Insert zone between segments */}
            {i < segments.length - 1 && (
              <button className={styles.insertBtn} onClick={() => props.onInsertAfter(seg.id)}>
                <span className={styles.insertBtnIcon}>+</span>
              </button>
            )}
          </div>
        );
      })}
      <button className={styles.appendBtn} onClick={onAppend}>+ 追加新段</button>
    </div>
  );
}
