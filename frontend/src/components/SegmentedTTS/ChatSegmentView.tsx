import type { Role, Segment, SegmentKind } from '../../types';
import { ChatBubble } from './ChatBubble';
import { NarrationBlock } from './NarrationBlock';
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
}: ChatSegmentViewProps) {
  return (
    <div className={styles.root}>
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
              onSelect={onSelect}
              onRegenerate={onRegenerate}
              onPlay={onPlay}
            />
          );
        })}
      </div>
      <div className={styles.actions}>
        <button type="button" onClick={() => onAppend('dialogue')}>+ 新增台词</button>
        <button type="button" onClick={() => onAppend('narration')}>+ 新增旁白</button>
      </div>
    </div>
  );
}
