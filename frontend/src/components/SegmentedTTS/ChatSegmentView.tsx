import { useState } from 'react';
import type { Role, RoleSnapshot, Segment, SegmentKind } from '../../types';
import { useTranslation } from '../../i18n';
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
  onUpdateRole?: (id: string, roleId: string | null, roleSnapshot: RoleSnapshot | null) => void;
  onUpdateKind?: (id: string, kind: SegmentKind, roleSnapshot: RoleSnapshot | null) => void;
  onUpdateProsodyMarks: (id: string, marks: NonNullable<Segment['prosody_marks']>) => void;
}

function toSnapshot(role: Role): RoleSnapshot {
  return {
    id: role.id,
    name: role.name,
    avatar: role.avatar,
    description: role.description,
    role_kind: role.role_kind ?? null,
    default_engine: role.default_engine,
    default_voice: role.default_voice,
    default_engine_params: { ...role.default_engine_params },
    favorite_styles: [...role.favorite_styles],
  };
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
  onUpdateProsodyMarks,
}: ChatSegmentViewProps) {
  const { t } = useTranslation();
  const [selection, setSelection] = useState<{ segmentId: string; start: number; end: number; text: string } | null>(null);

  const handleTextSelection = (segmentId: string, start: number, end: number, text: string) => {
    setSelection({ segmentId, start, end, text });
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
                  const nextRole = roles[0] ?? null;
                  onUpdateKind(id, 'dialogue', nextRole ? toSnapshot(nextRole) : null);
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
              isStale={isSegmentAudioStale(segment, segment.role_snapshot?.default_engine_params ?? segment.params)}
              onSelect={onSelect}
              onRegenerate={onRegenerate}
              onPlay={onPlay}
              onUpdateRole={onUpdateRole}
              onUpdateKind={onUpdateKind ? (id) => {
                // Narration segments use global Engine voice — no role assigned
                onUpdateKind(id, 'narration', null);
              } : undefined}
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
        <button type="button" onClick={() => onAppend('dialogue')}>{t('segment.chatSegmentView.addDialogue')}</button>
        <button type="button" onClick={() => onAppend('narration')}>{t('segment.chatSegmentView.addNarration')}</button>
      </div>
    </div>
  );
}
