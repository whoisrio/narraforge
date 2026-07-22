import { useState, useEffect, useRef } from 'react';
import type { EngineParams, Segment, EmotionType, VoiceProfile, Role, RoleSnapshot } from '../../types';
import { isSegmentAudioStale, isSegmentVoiceStale } from '../../services/segmentGenerationInputs';
import { VoiceAvatar } from '../ui/VoiceAvatar';
import { MergeMenu } from './MergeMenu';
import { useTranslation } from '../../i18n';
import styles from './SegmentRow.module.css';

interface SegmentRowProps {
  segment: Segment;
  index: number;
  isSelected: boolean;
  isPlaying: boolean;
  isPaused: boolean;
  compact?: boolean;
  voices: VoiceProfile[];
  globalVoiceId?: string;
  globalVoiceName?: string;
  globalEdgeVoice?: string;
  /** Current global engine */
  engine?: string;
  /** Global MiMo mode (preset | voiceclone) */
  globalMimoMode?: string;
  /** Global MiMo preset voice name */
  globalMimoPresetVoice?: string;
  /** Global MiMo clone voice ID */
  globalMimoCloneVoiceId?: string;
  layout: 'vertical' | 'horizontal';
  /** Start time in seconds from the beginning of the sequence */
  timeStart?: number;
  /** End time in seconds (start + this segment's duration) */
  timeEnd?: number;
  /** Available roles for lookup */
  roles: Role[];
  /** Snapshot of the role at generation time */
  roleSnapshot?: RoleSnapshot;
  /** The chapter's saved/applied voice params — used for staleness instead of live panel state */
  chapterVoice?: EngineParams;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onInsertAfter?: (afterId: string) => void;
  onEdit: (id: string) => void;
  onRegenerate: (id: string) => void;
  onPlay: (id: string) => void;
  onTrimSilence?: (id: string) => void;
  onUndo: (id: string) => void;
  onAnnotateSSML?: (id: string) => void;
  onDuplicate?: (id: string) => void;
  onToggleIndependentVoice?: (id: string) => void;
  onMerge?: (id: string, direction: 'up' | 'down') => void;
  isLast: boolean;
}

function fmtTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const mm = String(m).padStart(2, '0');
  const ss = `${s < 10 ? '0' : ''}${s.toFixed(1)}`;
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

const ENGINE_LABELS: Record<string, string> = {
  cosyvoice: 'CosyVoice', edge_tts: 'Edge-TTS', mimo_tts: 'MiMo', voxcpm: 'VoxCPM',
};

const EMOTION_LABELS: Record<EmotionType, string> = {
  happy: 'segmentEdit.emotion.happy', sad: 'segmentEdit.emotion.sad', angry: 'segmentEdit.emotion.angry',
  calm: 'segmentEdit.emotion.calm', neutral: 'segmentEdit.emotion.neutral', excited: 'segmentEdit.emotion.excited',
};

const WF_SHAPES: number[][] = [
  [20,35,50,65,80,70,85,60,75,90,65,55,70,85,60,45,55,75,80,65,50,40,60,70,55,45,35,25],
  [30,45,55,70,60,75,85,90,80,70,65,80,75,60,50,65,80,85,70,55,45,60,75,85,70,55,40,30],
  [25,40,60,55,70,85,75,90,80,65,50,55,70,85,80,65,50,40,55,70,80,75,60,45,55,65,50,35],
  [35,50,65,80,75,60,70,85,90,80,65,55,45,60,75,85,70,55,45,60,80,85,75,60,50,40,55,30],
];

function getWaveform(id: string): number[] {
  const sum = id.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const shape = WF_SHAPES[sum % WF_SHAPES.length];
  const off = sum % shape.length;
  return [...shape.slice(off), ...shape.slice(0, off)];
}

export function SegmentRow({
  segment, index, isSelected, isPlaying, isPaused, compact, voices, globalVoiceId, globalVoiceName, globalEdgeVoice, engine,
  globalMimoMode, globalMimoPresetVoice, globalMimoCloneVoiceId,
  layout, timeStart, timeEnd, roles, roleSnapshot, chapterVoice,
  onSelect, onDelete, onEdit, onRegenerate, onPlay, onTrimSilence, onToggleIndependentVoice,
  onMerge, isLast,
}: SegmentRowProps) {
  const { t } = useTranslation();
  const [charIdx, setCharIdx] = useState(-1);
  const timerRef = useRef<number | null>(null);
  const textLen = segment.text.length;

  useEffect(() => {
    if (isPlaying && segment.audio.duration_sec && textLen > 0) {
      const ms = (segment.audio.duration_sec * 1000) / textLen;
      setCharIdx(0);
      let i = 0;
      timerRef.current = window.setInterval(() => {
        i++;
        if (i >= textLen) {
          if (timerRef.current) clearInterval(timerRef.current);
          timerRef.current = null;
          setTimeout(() => setCharIdx(-1), 600);
          return;
        }
        setCharIdx(i);
      }, ms);
      return () => { if (timerRef.current) clearInterval(timerRef.current); setCharIdx(-1); };
    }
    setCharIdx(-1);
  }, [isPlaying, segment.audio.duration_sec, textLen]);

  const isGenerating = segment.status === 'pending' || segment.status === 'queued';
  const isReady = segment.status === 'ready';
  const isFailed = segment.status === 'failed';
  const isIdle = segment.status === 'idle';
  // SSML is stored in generated_params (or custom voice.params for un-generated segments)
  const hasSSML: boolean = !!(
    (segment.generated_params as Record<string, unknown>)?.ssml
    || (segment.voice.source === 'custom' && (segment.voice.params as unknown as Record<string, unknown>)?.ssml)
  );
  const emotion = segment.emotion || 'neutral';
  const emoCamel = emotion.charAt(0).toUpperCase() + emotion.slice(1); // happy -> Happy
  const hasOverride = segment.voice.source === 'custom';
  const useIndependentVoice = hasOverride;
  const idx = String(index).padStart(2, '0');
  const waveform = getWaveform(segment.id);

  // Resolve the effective role (for role-based and custom-with-role sources)
  const resolvedRole: Role | RoleSnapshot | undefined = (() => {
    const vs = segment.voice;
    if (vs.source === 'role') {
      return roles.find(r => r.id === vs.role_id) || roleSnapshot;
    }
    if (vs.source === 'custom' && vs.role_id) {
      return roles.find(r => r.id === vs.role_id);
    }
    return undefined;
  })();

  // effectiveEngine: what engine this segment WOULD use right now
  const effectiveEngine = segment.voice.source === 'custom'
    ? segment.voice.engine
    : (resolvedRole?.voice?.engine || engine || 'cosyvoice');

  // Resolve voice display from the VoiceSource discriminated union
  const resolveVoiceDisplay = (): { engine: string; voice: string } => {
    const vs = segment.voice;

    // When audio is generated, prefer engine from generated_params
    const dispEngine = (isReady && segment.generated_params?.engine)
      ? segment.generated_params.engine
      : effectiveEngine;
    const eng = ENGINE_LABELS[dispEngine] || dispEngine;

    /** Extract a human-readable voice name from engine params */
    const extractVoiceName = (srcEngine: string, params: Record<string, unknown>): string => {
      if (srcEngine === 'edge_tts') {
        const ev = (params.voice || '') as string;
        if (ev) {
          const parts = ev.split('-');
          return (parts[parts.length - 1] || ev).replace(/Neural$|V\d+$/i, '');
        }
        return t('segment.segmentRow.voiceNotSelected');
      }
      if (srcEngine === 'mimo_tts') {
        const mode = (params.mode || 'preset') as string;
        if (mode === 'voiceclone' || mode === 'voicedesign') {
          const cloneId = params.voice_id as string | undefined;
          if (cloneId) {
            const vObj = voices.find(v => v.id === cloneId);
            return vObj?.name || (mode === 'voicedesign' ? t('segment.segmentRow.voiceDesigned') : t('segment.segmentRow.customVoice'));
          }
          if (mode === 'voicedesign') {
            const desc = (params.voice_description || '') as string;
            return desc ? desc.slice(0, 20) : t('segment.segmentRow.voiceDesigned');
          }
          return t('segment.segmentRow.voiceNotSelected');
        }
        return (params.voice_id as string) || t('segment.segmentRow.voiceNotSelected');
      }
      // CosyVoice / VoxCPM
      const vid = params.voice_id as string | undefined;
      if (vid) {
        const vObj = voices.find(v => {
          const voiceVid = (v.voice_params?.[v.voice?.model || '']?.params as Record<string, unknown>)?.voice_id as string | undefined;
          return (voiceVid || v.id) === vid;
        });
        if (vObj?.name) return vObj.name;
        if (vid.startsWith('cosyvoice-')) return t('segment.segmentRow.cosyVoice');
        if (vid.startsWith('voxcpm-')) return t('segment.segmentRow.voxcpmVoice');
        return vid.length > 20 ? `${vid.slice(0, 8)}…` : vid;
      }
      return t('segment.segmentRow.voiceNotSelected');
    };

    switch (vs.source) {
      case 'role': {
        if (resolvedRole) {
          return { engine: eng, voice: resolvedRole.name };
        }
        return { engine: eng, voice: t('segment.segmentRow.voiceNotSelected') };
      }
      case 'chapter': {
        // Display from chapterVoice (applied voice), not generated_params or panel state.
        // generated_params is only for staleness comparison, not display.
        const saved = (chapterVoice as unknown as Record<string, unknown>);
        if (saved) {
          const srcEngine = String(saved.engine || effectiveEngine);
          return { engine: eng, voice: extractVoiceName(srcEngine, saved) };
        }
        // Fallback: live panel state (only when no chapterVoice at all)
        const chapterParams: Record<string, unknown> = {};
        if (effectiveEngine === 'edge_tts') {
          chapterParams.voice = globalEdgeVoice || '';
        } else if (effectiveEngine === 'mimo_tts') {
          chapterParams.mode = globalMimoMode;
          chapterParams.voice_id = globalMimoPresetVoice || globalMimoCloneVoiceId;
        } else {
          chapterParams.voice_id = globalVoiceId;
        }
        const voiceName = extractVoiceName(effectiveEngine, chapterParams);
        if (!voiceName || voiceName === t('segment.segmentRow.voiceNotSelected')) {
          if (globalVoiceName) return { engine: eng, voice: globalVoiceName };
        }
        return { engine: eng, voice: voiceName };
      }
      case 'custom': {
        const params = (isReady && segment.generated_params)
          ? (segment.generated_params as unknown as Record<string, unknown>)
          : (vs.params as unknown as Record<string, unknown>);
        const voiceName = extractVoiceName(dispEngine, params);
        if (voiceName && voiceName !== t('segment.segmentRow.voiceNotSelected')) {
          return { engine: eng, voice: voiceName };
        }
        // Locked with no custom params yet — inherit display from saved voice
        const fallback = (chapterVoice as unknown as Record<string, unknown>) || {};
        const fbVn = extractVoiceName(dispEngine, fallback);
        return { engine: eng, voice: fbVn || voiceName || t('segment.segmentRow.customVoice') };
      }
    }
  };

  const { engine: displayEngine, voice: voiceDisplayName } = resolveVoiceDisplay();

  // Resolve voice ID for gender lookup from the correct source.
  // For custom segments with empty params (just locked), fall back to chapterVoice.
  const voiceVoiceId = (() => {
    const vs = segment.voice;
    if (vs.source === 'custom') {
      const cv = (vs.params as unknown as Record<string, unknown>)?.voice_id as string | undefined;
      return cv || (chapterVoice as unknown as Record<string, unknown>)?.voice_id as string | undefined;
    }
    if (vs.source === 'role' && resolvedRole?.voice) {
      return (resolvedRole.voice as unknown as Record<string, unknown>).voice_id as string | undefined;
    }
    return (chapterVoice as unknown as Record<string, unknown>)?.voice_id as string | undefined
      || globalVoiceId;
  })();
  const voiceObj = voices.find(v => {
    const voiceVid = (v.voice_params?.[v.voice?.model || '']?.params as Record<string, unknown>)?.voice_id as string | undefined;
    return (voiceVid || v.id) === voiceVoiceId;
  });

  // Edge-TTS voice technical name for gender heuristic.
  // For custom segments with empty params (just locked), fall back to chapterVoice.
  const edgeVoiceForGender: string = (() => {
    const vs = segment.voice;
    if (vs.source === 'custom') {
      const cv = (vs.params as unknown as Record<string, unknown>)?.voice as string;
      if (cv) return cv;
      return ((chapterVoice as unknown as Record<string, unknown>)?.voice as string) || '';
    }
    if (vs.source === 'role' && resolvedRole?.voice) {
      return ((resolvedRole.voice as unknown as Record<string, unknown>).voice as string || '');
    }
    return ((chapterVoice as unknown as Record<string, unknown>)?.voice as string) || globalEdgeVoice || '';
  })();

  const resolveGender = (): string => {
    const desc = (voiceObj?.description || voiceObj?.name || '').toLowerCase();
    if (desc.includes('女') || desc.includes('female')) return 'female';
    if (desc.includes('男') || desc.includes('male')) return 'male';
    // For Edge-TTS, check the relevant edge voice name
    if (effectiveEngine === 'edge_tts') {
      if (/xiaoxiao|xiaoyi|xiaomeng|xiaomo|xiaorui|xiaoyan|jenny|aria|jane|sara|lisa/i.test(edgeVoiceForGender)) return 'female';
      return 'male';
    }
    return 'male'; // default
  };
  const voiceGender = resolveGender();

  // ---- Stale detection ----
  // Use the shared helper so role snapshots and prosody marks participate in
  // staleness alongside engine/voice. The helper compares the segment's
  // effective generation inputs against generated_params.
  
  const generatedEngine = segment.generated_params?.engine;

  // Resolve the current global voice identifier for comparison (per-engine).
  const currentGlobalVoice = effectiveEngine === 'edge_tts'
    ? (globalEdgeVoice || '')
    : effectiveEngine === 'mimo_tts'
      ? (globalMimoMode === 'voiceclone' ? (globalMimoCloneVoiceId || '') : (globalMimoPresetVoice || ''))
      : (globalVoiceId || '');

  // Build params for staleness comparison from the voice source.
  // Use chapterVoice (applied/saved) for chapter-source segments so that
  // unreviewed panel changes do NOT trigger staleness until Apply is clicked.
  const staleEngine = (segment.voice.source === 'chapter' && chapterVoice)
    ? (chapterVoice.engine || effectiveEngine)
    : effectiveEngine;
  const defaultParamsForStale: Record<string, unknown> = {
    engine: staleEngine,
  };
  if (segment.voice.source === 'custom') {
    Object.assign(defaultParamsForStale, segment.voice.params as unknown as Record<string, unknown>);
  } else if (segment.voice.source === 'role' && resolvedRole?.voice) {
    Object.assign(defaultParamsForStale, resolvedRole.voice as unknown as Record<string, unknown>);
  } else if (chapterVoice) {
    // chapter source: use the saved/applied chapter voice, not live panel state
    const cv = chapterVoice as unknown as Record<string, unknown>;
    if (staleEngine === 'edge_tts') {
      defaultParamsForStale.voice = cv.voice;
    } else if (staleEngine === 'mimo_tts') {
      defaultParamsForStale.mode = cv.mode;
      defaultParamsForStale.voice_id = cv.voice_id;
    } else {
      defaultParamsForStale.voice_id = cv.voice_id;
    }
  } else {
    // Fallback (no chapterVoice): use live panel state as before
    if (effectiveEngine === 'edge_tts') {
      defaultParamsForStale.voice = globalEdgeVoice;
    } else if (effectiveEngine === 'mimo_tts') {
      defaultParamsForStale.mode = globalMimoMode;
      defaultParamsForStale.voice_id = globalMimoPresetVoice || globalMimoCloneVoiceId;
    } else {
      defaultParamsForStale.voice_id = globalVoiceId;
    }
  }
  // Engine changed → stale (unless locked). Compare against staleEngine now that it's defined.
  const engineChanged = !hasOverride && !!generatedEngine && generatedEngine !== staleEngine;
  // Extract voice identifier from generated_params (replaces deprecated generated_voice_id)
  const generatedVoiceId: string | undefined = segment.generated_params
    ? ((segment.generated_params as Record<string, unknown>).voice_id as string
      || (segment.generated_params as Record<string, unknown>).voice as string)
    : undefined;
  const isStale = segment.generated_params
    ? isSegmentAudioStale(segment, defaultParamsForStale)
    // Legacy / frontend-mode audio without recorded generated_params: fall back
    // to voice/engine comparison so a global voice change is still detected.
    : isSegmentVoiceStale({
        status: segment.status,
        hasVoiceOverride: !!hasOverride,
        generatedEngine,
        effectiveEngine: staleEngine as string,
        generatedVoiceId,
        currentGlobalVoice,
      });

  const currentGlobalVoiceLabel = (() => {
    const cv = chapterVoice as unknown as Record<string, unknown> | undefined;
    const eng = (cv?.engine || effectiveEngine) as string;
    if (eng === 'edge_tts') {
      const v = (cv?.voice || globalEdgeVoice || '') as string;
      const parts = v.split('-');
      return (parts[parts.length - 1] || v).replace(/Neural$|V\d+$/i, '');
    }
    if (eng === 'mimo_tts') {
      const mode = (cv?.mode || globalMimoMode) as string;
      return mode === 'voiceclone' ? t('segment.segmentRow.customVoice')
        : ((cv?.voice_id || globalMimoPresetVoice || '') as string);
    }
    return (globalVoiceName || currentGlobalVoice || '') as string;
  })();

  const dur = isReady && segment.audio.duration_sec
    ? segment.audio.duration_sec.toFixed(1) + 's'
    : isGenerating ? '...' : '';

  if (layout === 'horizontal') {
    return (
      <div className={`${styles.hBlock} ${styles[`st${segment.status.charAt(0).toUpperCase() + segment.status.slice(1)}`] || ''} ${isSelected ? styles.selH : ''}`}
        onClick={() => onSelect(segment.id)} title={segment.text}>
        <span className={styles.hIdx}>#{idx}</span>
        <span className={styles.hDur}>
          {timeStart != null ? `${fmtTime(timeStart)}${timeEnd != null ? `–${fmtTime(timeEnd)}` : '–…'}` : (dur || '—')}
        </span>
        <span className={styles.hTxt}>{segment.text.slice(0, 8)}{segment.text.length > 8 ? '…' : ''}</span>
      </div>
    );
  }

  const renderText = (className?: string) => {
    if (charIdx < 0) return <span className={className || styles.txt}>{segment.text}</span>;
    return (
      <span className={className || styles.txt}>
        {segment.text.split('').map((c, i) => (
          <span key={i} className={i <= charIdx ? styles.charLit : styles.charDim}>{c}</span>
        ))}
      </span>
    );
  };

  // ---- Compact mode: single row ----
  if (compact) {
    return (
      <div
        className={`${styles.compactCard} ${styles[`emo${emoCamel}`] || ''} ${isSelected ? styles.selected : ''} ${isPlaying ? styles.playing : ''}`}
        onClick={() => onSelect(segment.id)}
      >
        <div className={styles.compactEmo} />
        <div className={styles.compactAvatarWrap}>
          <VoiceAvatar name={voiceDisplayName} avatar={resolvedRole?.avatar} size={28} gender={voiceGender} />
        </div>
        <div className={styles.compactVoice}>
          <span className={styles.compactVoiceName} title={voiceDisplayName}>{voiceDisplayName}</span>
          <span className={styles.compactVoiceEngine}>{displayEngine}</span>
        </div>
        <span className={styles.compactIdx}>#{idx}</span>
        {segment.emotion && (
          <span className={`${styles.emoTag} ${styles[`tag${emoCamel}`]}`}>{t(EMOTION_LABELS[emotion])}</span>
        )}
        {timeStart != null && (
          <span className={styles.compactTime}>
            {fmtTime(timeStart)}{timeEnd != null ? `–${fmtTime(timeEnd)}` : '–…'}
          </span>
        )}
        {renderText(styles.compactText)}
        <span className={styles.compactDur}>{dur}</span>
        {(isIdle || isFailed) && (
          <button className={styles.compactGenBtn} disabled={isGenerating}
            onClick={(e) => { e.stopPropagation(); onRegenerate(segment.id); }}>
            {isGenerating ? '⏳' : '▶'}
          </button>
        )}
        {isReady && isStale && (
          <span className={styles.compactStale} title={t('segment.segmentRow.voiceChanged')}>⚠</span>
        )}
        {/* Only show toggle for non-role segments (narration follows global, can be locked/unlocked) */}
        {segment.voice.source !== 'role' && (
          <button
            className={`${styles.compactVoiceLock} ${useIndependentVoice ? styles.compactVoiceLockActive : ''}`}
            title={t(useIndependentVoice ? 'segment.segmentRow.unlockTooltip' : 'segment.segmentRow.lockTooltip')}
            onClick={(e) => { e.stopPropagation(); onToggleIndependentVoice?.(segment.id); }}
          >
            {useIndependentVoice ? '🔒' : '🔗'}
          </button>
        )}
        {/* Role segments: always locked (show lock icon, no click) */}
        {segment.voice.source === 'role' && (
          <span className={styles.compactVoiceLock + ' ' + styles.compactVoiceLockActive} title={t('segment.segmentRow.roleLocked')}>🔒</span>
        )}
        {onMerge && (
          <MergeMenu segmentId={segment.id} canUp={index > 1} canDown={!isLast} onMerge={onMerge} compact />
        )}
        {isReady && (
          <button className={styles.compactPlayBtn} title={t(isPlaying && !isPaused ? 'segment.segmentRow.pause' : 'segment.segmentRow.play')}
            onClick={(e) => { e.stopPropagation(); onPlay(segment.id); }}>
            {isPlaying && !isPaused ? '⏸' : '▶'}
          </button>
        )}
        <button className={styles.compactDelBtn} title={t('common.delete')} disabled={isGenerating}
          onClick={(e) => { e.stopPropagation(); onDelete(segment.id); }}>
          ✕
        </button>
      </div>
    );
  }

  // ---- Expanded mode ----
  return (
    <div
      className={`${styles.card} ${styles[`emo${emoCamel}`] || ''} ${styles[`st${segment.status.charAt(0).toUpperCase() + segment.status.slice(1)}`] || ''} ${isSelected ? styles.selected : ''} ${isPlaying ? styles.playing : ''} ${isStale ? styles.stale : ''}`}
      onClick={() => onSelect(segment.id)}
    >
      <div className={styles.avatarCol}>
        <VoiceAvatar name={voiceDisplayName} avatar={resolvedRole?.avatar} size={48} gender={voiceGender}
          label={voiceDisplayName}
          sublabel={displayEngine} />
        {isSelected && <span className={styles.editingBadge}>{t('segment.segmentRow.editing')}</span>}
      </div>

      <div className={styles.body}>
        {/* Main: index + centered text + duration */}
        <div className={styles.mainRow}>
          <span className={styles.idx}>#{idx}</span>
          <div className={styles.txtCenter}>
            {renderText()}
          </div>
          <span className={styles.dur}>{dur}</span>
        </div>

        {/* Stale warning */}
        {isStale && (
          <div className={styles.staleWarn}>
            ⚠ {engineChanged ? t('segment.segmentRow.engineChanged') : t('segment.segmentRow.voiceChangedText')}（当前全局: {ENGINE_LABELS[effectiveEngine] || effectiveEngine}{currentGlobalVoiceLabel ? ` · ${currentGlobalVoiceLabel}` : ''}），{t('segment.segmentRow.suggestRegenerate')}
          </div>
        )}

        {/* Time range — subtitle-style timestamp */}
        {timeStart != null && (
          <div className={styles.timeRange}>
            {fmtTime(timeStart)}{timeEnd != null ? ` – ${fmtTime(timeEnd)}` : ' – …'}
          </div>
        )}

        {/* Decorative waveform */}
        {isReady && segment.audio.current?.id && (
          <div className={styles.waveDecor}>
            {waveform.map((h, i) => <div key={i} className={styles.wfBar} style={{ height: `${h}%` }} />)}
          </div>
        )}

        {/* Bottom: emotion + voice/model info + actions */}
        <div className={styles.metaRow}>
          <div className={styles.badges}>
            {segment.emotion && (
              <span className={`${styles.emoTag} ${styles[`tag${emoCamel}`]}`}>{t(EMOTION_LABELS[emotion])}</span>
            )}
            {hasOverride && (
              <button
                className={styles.indVoiceToggle}
                title={t('segment.segmentRow.clickToCancelIndependent')}
                onClick={(e) => { e.stopPropagation(); onToggleIndependentVoice?.(segment.id); }}
              >
                {t('segment.segmentRow.locked')}
              </button>
            )}
            {!hasOverride && isReady && (
              <button
                className={styles.indVoiceToggleOff}
                title={t('segment.segmentRow.clickToLockIndependent')}
                onClick={(e) => { e.stopPropagation(); onToggleIndependentVoice?.(segment.id); }}
              >
                {t('segment.segmentRow.global')}
              </button>
            )}
            {isReady && !isStale && <span className={styles.readyMark}>✓</span>}
            {isFailed && <span className={styles.failMark}>✕ {segment.error || ''}</span>}
            {isIdle && <span className={styles.idleText}>{t('segment.segmentRow.idle')}</span>}
            {hasSSML && <span className={styles.ssmlMark}>SSML</span>}
          </div>
          <div className={styles.actions}>
            {/* Generate button for idle/failed */}
            {(isIdle || isFailed) && (
              <button className={isFailed ? styles.genBtnFail : styles.genBtn} disabled={isGenerating}
                onClick={(e) => { e.stopPropagation(); onRegenerate(segment.id); }}>
                {isGenerating ? '⏳' : `▶ ${t('segment.segmentRow.generate')}`}
              </button>
            )}
            {isGenerating && <span className={styles.genBadge}>⏳</span>}
            {isReady && (
              <button className={styles.actPlay} title={t(isPlaying && !isPaused ? 'segment.segmentRow.pause' : 'segment.segmentRow.play')}
                onClick={(e) => { e.stopPropagation(); onPlay(segment.id); }}>
                {isPlaying && !isPaused ? '⏸' : '▶'}
              </button>
            )}
            <button className={styles.actBtn} title={t('segment.segmentRow.edit')}
              onClick={(e) => { e.stopPropagation(); onEdit(segment.id); }}>✎</button>
            {isReady && (
              <button className={styles.actBtn} title={t('segment.segmentRow.regenerate')}
                onClick={(e) => { e.stopPropagation(); onRegenerate(segment.id); }}>↻</button>
            )}
            {isReady && onTrimSilence && (
              <button className={styles.actBtn} title={t('segment.segmentRow.trim')}
                onClick={(e) => { e.stopPropagation(); onTrimSilence(segment.id); }}>✂</button>
            )}
            {onMerge && (
              <MergeMenu segmentId={segment.id} canUp={index > 1} canDown={!isLast} onMerge={onMerge} />
            )}
            <button className={styles.actBtnDanger} title={t('common.delete')} disabled={isGenerating}
              onClick={(e) => { e.stopPropagation(); onDelete(segment.id); }}>✕</button>
          </div>
        </div>
      </div>
    </div>
  );
}
