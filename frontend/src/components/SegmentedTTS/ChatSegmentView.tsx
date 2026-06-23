import { useState } from 'react';
import type { Role, Segment, SegmentKind } from '../../types';
import { isSegmentAudioStale } from '../../services/segmentGenerationInputs';
import { ChatBubble } from './ChatBubble';
import { NarrationBlock } from './NarrationBlock';
import { ProsodyMarkEditor } from './ProsodyMarkEditor';
import styles from './ChatSegmentView.module.css';

interface ChatSegmentViewProps {
  segments: Segment[];
  roles: Role[];
  selectedId?: string;
  playingId?: string;
  hasNarratorVoice: boolean;
  onSelect: (id: string) => void;
  onAppend: (kind: SegmentKind) => void;
  onRegenerate: (id: string) => void;
  onPlay: (id: string) => void;
  onUpdateProsodyMarks: (id: string, marks: NonNullable<Segment['prosody_marks']>) => void;
}

export function ChatSegmentView({
  segments,
  roles,
  selectedId,
  playingId,
  hasNarratorVoice,
  onSelect,
  onAppend,
  onRegenerate,
  onPlay,
  onUpdateProsodyMarks,
}: ChatSegmentViewProps) {
  const [selection, setSelection] = useState<{ segmentId: string; start: number; end: number; text: string } | null>(null);

  const handleTextSelection = (segmentId: string, start: number, end: number, text: string) => {
    setSelection({ segmentId, start, end, text });
  };

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <span className={styles.kicker}>Script Production Flow</span>
        <p>旁白与台词按生产顺序排列，保留生成、播放和局部语气标记。</p>
      </div>
      {!hasNarratorVoice && (
        <div className={styles.narratorWarning}>多角色项目需要设置旁白音色。请在角色库中创建旁白角色并设为项目旁白。</div>
      )}
      <div className={styles.flow}>
        {segments.map((segment, index) => {
          const kind = segment.segment_kind ?? 'narration';
          if (kind === 'narration') {
            return (
              <NarrationBlock
                key={segment.id}
                segment={segment}
                index={index + 1}
                isSelected={segment.id === selectedId}
                hasNarratorVoice={hasNarratorVoice}
                onSelect={onSelect}
                onTextSelection={handleTextSelection}
              />
            );
          }
          return (
            <ChatBubble
              key={segment.id}
              segment={segment}
              index={index + 1}
              role={roles.find(role => role.id === segment.role_id)}
              isSelected={segment.id === selectedId}
              isPlaying={segment.id === playingId}
              isStale={isSegmentAudioStale(segment, segment.role_snapshot?.default_engine_params ?? segment.params)}
              onSelect={onSelect}
              onRegenerate={onRegenerate}
              onPlay={onPlay}
              onTextSelection={handleTextSelection}
            />
          );
        })}
      </div>
      <ProsodyMarkEditor
        selection={selection}
        onCancel={() => setSelection(null)}
        onSave={(mark) => {
          if (!selection) return;
          const segment = segments.find(item => item.id === selection.segmentId);
          const marks = [...(segment?.prosody_marks ?? []), mark];
          onUpdateProsodyMarks(selection.segmentId, marks);
          setSelection(null);
        }}
      />
      <div className={styles.actions}>
        <button type="button" onClick={() => onAppend('dialogue')}>+ 新增台词</button>
        <button type="button" onClick={() => onAppend('narration')}>+ 新增旁白</button>
      </div>
    </div>
  );
}
