import type { Role, Segment, SegmentKind } from '../../types';
import { useTranslation } from '../../i18n';
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
  onUpdateRole?: (id: string, roleId: string | null) => void;
  onUpdateKind?: (id: string, kind: SegmentKind) => void;
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
  onUpdateRole,
  onUpdateKind,
}: ChatSegmentViewProps) {
  const { t } = useTranslation();

  const handleTextSelection = () => {
    // placeholder for future text selection feature
  };

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <span className={styles.kicker}>Script Production Flow</span>
        <p>{t('segment.chatSegmentView.description')}</p>
      </div>
      {!hasNarratorVoice && (
        <div className={styles.narratorWarning}>{t('segment.chatSegmentView.narratorWarning')}</div>
      )}
      <div className={styles.flow}>
        {segments.length === 0 && (
          <div className={styles.emptyState}>
            <span className={styles.emptyIcon}>◎</span>
            <h3>{t('segment.chatSegmentView.noSegments')}</h3>
            <p>{t('segment.chatSegmentView.noSegmentsHint')}</p>
          </div>
        )}
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
                onUpdateKind={onUpdateKind ? (id) => {
                  onUpdateKind(id, 'dialogue');
                } : undefined}
              />
            );
          }
          return (
            <ChatBubble
              key={segment.id}
              segment={segment}
              index={index + 1}
              role={roles.find(role => role.id === segment.role_id)}
              roles={roles}
              isSelected={segment.id === selectedId}
              isPlaying={segment.id === playingId}
              isStale={false}
              onSelect={onSelect}
              onRegenerate={onRegenerate}
              onPlay={onPlay}
              onUpdateRole={onUpdateRole}
              onUpdateKind={onUpdateKind ? (id) => {
                // Narration segments use global Engine voice — no role assigned
                onUpdateKind(id, 'narration');
              } : undefined}
              onTextSelection={handleTextSelection}
            />
          );
        })}
      </div>
      <div className={styles.actions}>
        <button type="button" onClick={() => onAppend('dialogue')}>{t('segment.chatSegmentView.addDialogue')}</button>
        <button type="button" onClick={() => onAppend('narration')}>{t('segment.chatSegmentView.addNarration')}</button>
      </div>
    </div>
  );
}
