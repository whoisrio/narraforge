import type { Segment, SegmentEngineParams, VoiceProfile, Role, RoleSnapshot, SegmentKind } from '../../types';
import type { SplitVoiceMode } from '../../services/segmentKindInference';
import { inferSpeakerName } from '../../services/segmentKindInference';
import { t } from '../../i18n';
import { VoiceAvatar } from '../ui/VoiceAvatar';
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
  voiceMode?: SplitVoiceMode;
  voices: VoiceProfile[];
  roles?: Role[];
  globalVoiceId?: string;
  globalVoiceName?: string;
  globalEdgeVoice?: string;
  engine?: string;
  globalMimoMode?: string;
  globalMimoPresetVoice?: string;
  globalMimoCloneVoiceId?: string;
  /** Cumulative time offset from previous chapters (seconds) */
  chapterStartOffset?: number;
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
  onUpdateRole?: (id: string, roleId: string | null, roleSnapshot: RoleSnapshot | null) => void;
  onUpdateKind?: (id: string, kind: SegmentKind, roleSnapshot: RoleSnapshot | null) => void;
  onToggleIndependentVoice?: (id: string) => void;
  onMerge?: (id: string, direction: 'up' | 'down') => void;
  onSplit?: (id: string, position: number) => void;
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '');
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

export function SegmentList(props: SegmentListProps) {
  const { segments, layout, selectedId, playingId, isPaused, compact, voiceMode = 'narration', voices, globalVoiceId, globalVoiceName, globalEdgeVoice, globalMimoMode, globalMimoPresetVoice, globalMimoCloneVoiceId, onAppend, onEdit, onPlay } = props;
  const allRoles = props.roles ?? [];
  const showKindControls = voiceMode !== 'narration';
  // Compute cumulative time ranges for each segment (starting from chapter offset)
  const timeRanges: { start: number; end?: number }[] = [];
  let cumulative = props.chapterStartOffset ?? 0;
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
    compact, voices, globalVoiceId, globalVoiceName, globalEdgeVoice, engine: props.engine,
    globalMimoMode, globalMimoPresetVoice, globalMimoCloneVoiceId,
    timeStart: timeRanges[i]?.start, timeEnd: timeRanges[i]?.end,
    onSelect: props.onSelect, onDelete: props.onDelete,
    onInsertAfter: props.onInsertAfter, onEdit: onEdit,
    onRegenerate: props.onRegenerate, onPlay: onPlay, onTrimSilence: props.onTrimSilence, onUndo: props.onUndo,
    onAnnotateSSML: props.onAnnotateSSML, onDuplicate: props.onDuplicate,
    onToggleIndependentVoice: props.onToggleIndependentVoice,
    onMerge: props.onMerge, isLast: i === segments.length - 1,
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
            {showKindControls && <div className={styles.roleStrip}>
              <span className={styles.kindBadge}>{(seg.segment_kind ?? 'narration') === 'dialogue' ? t('studio.dialogue') : t('studio.narration')}</span>
              {props.onUpdateKind && (
                <button
                  type="button"
                  className={styles.kindSwitch}
                  onClick={() => {
                    const nextKind: SegmentKind = (seg.segment_kind ?? 'narration') === 'dialogue' ? 'narration' : 'dialogue';
                    // Narration → no role (voice from global Engine); Dialogue → first matching role
                    const nextRole = nextKind === 'dialogue'
                      ? (inferSpeakerName(seg.text) ? allRoles.find(r => normalizeName(r.name) === normalizeName(inferSpeakerName(seg.text)!)) : allRoles[0]) ?? allRoles[0] ?? null
                      : null;
                    props.onUpdateKind?.(seg.id, nextKind, nextRole ? toSnapshot(nextRole) : null);
                  }}
                >
                  {(seg.segment_kind ?? 'narration') === 'dialogue' ? t('studio.narration') : t('studio.dialogue')}
                </button>
              )}
              {props.onUpdateRole && (seg.segment_kind ?? 'narration') === 'dialogue' && (
                <div className={styles.roleChipBar} role="group" aria-label="选择台词角色">
                  {allRoles.map(role => {
                    const isActive = seg.role_id === role.id;
                    return (
                      <button
                        key={role.id}
                        type="button"
                        className={`${styles.roleChip} ${isActive ? styles.roleChipActive : ''}`}
                        onClick={() => props.onUpdateRole?.(seg.id, role.id, toSnapshot(role))}
                        title={role.name}
                      >
                        <VoiceAvatar avatar={role.avatar} name={role.name} engine={role.default_engine} size={20} />
                        <span className={styles.roleChipName}>{role.name}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>}
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
                  onSplit={props.onSplit}
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
