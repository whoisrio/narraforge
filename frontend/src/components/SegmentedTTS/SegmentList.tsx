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
  // Edit panel props
  onUpdateText?: (id: string, text: string) => void;
  onUpdateSSML?: (id: string, ssml: string) => void;
  onUpdateParams?: (id: string, params: Partial<SegmentEngineParams>) => void;
  onUpdateEmotion?: (id: string, emotion: string) => void;
}

export function SegmentList(props: SegmentListProps) {
  const { segments, layout, selectedId, playingId, isPaused, voices, globalVoiceId, globalVoiceName, globalEdgeVoice, onAppend, onEdit, onPlay } = props;

  const rowProps = (seg: Segment, i: number) => ({
    segment: seg, index: i + 1, isSelected: seg.id === selectedId,
    isPlaying: seg.id === playingId, isPaused: !!(isPaused && seg.id === playingId), voices, globalVoiceId, globalVoiceName, globalEdgeVoice,
    onSelect: props.onSelect, onDelete: props.onDelete,
    onInsertAfter: props.onInsertAfter, onEdit: onEdit,
    onRegenerate: props.onRegenerate, onPlay: onPlay, onTrimSilence: props.onTrimSilence, onUndo: props.onUndo,
    onAnnotateSSML: props.onAnnotateSSML, onDuplicate: props.onDuplicate,
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
          </div>
        );
      })}
      <button className={styles.appendBtn} onClick={onAppend}>+ 追加新段</button>
    </div>
  );
}
