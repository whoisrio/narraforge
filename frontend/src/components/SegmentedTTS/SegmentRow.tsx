import { useState, useEffect, useRef } from 'react';
import type { Segment, EmotionType, VoiceProfile } from '../../types';
import { isSegmentAudioStale, isSegmentVoiceStale } from '../../services/segmentGenerationInputs';
import { VoiceAvatar } from '../ui/VoiceAvatar';
import { MergeMenu } from './MergeMenu';
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
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${s < 10 ? '0' : ''}${s.toFixed(1)}`;
}

const ENGINE_LABELS: Record<string, string> = {
  cosyvoice: 'CosyVoice', edge_tts: 'Edge-TTS', mimo_tts: 'MiMo',
};

const EMOTION_LABELS: Record<EmotionType, string> = {
  happy: '欣喜', sad: '沉重', angry: '愤怒',
  calm: '沉稳', neutral: '中性', excited: '激昂',
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
 layout, timeStart, timeEnd, onSelect, onDelete, onEdit, onRegenerate, onPlay, onTrimSilence, onUndo: _onUndo, onToggleIndependentVoice,
 onMerge, isLast,
}: SegmentRowProps) {
  const [charIdx, setCharIdx] = useState(-1);
  const timerRef = useRef<number | null>(null);
  const textLen = segment.text.length;

  useEffect(() => {
    if (isPlaying && segment.duration_sec && textLen > 0) {
      const ms = (segment.duration_sec * 1000) / textLen;
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
  }, [isPlaying, segment.duration_sec, textLen]);

  const isGenerating = segment.status === 'pending' || segment.status === 'queued';
  const isReady = segment.status === 'ready';
  const isFailed = segment.status === 'failed';
  const isIdle = segment.status === 'idle';
  const emotion = segment.emotion || 'neutral';
  const emoCamel = emotion.charAt(0).toUpperCase() + emotion.slice(1); // happy -> Happy
  const hasOverride = segment.overrides?.includes('voice');
  const useIndependentVoice = hasOverride;
  const idx = String(index).padStart(2, '0');
  const waveform = getWaveform(segment.id);

  // effectiveEngine: what engine this segment WOULD use right now
  const effectiveEngine = hasOverride ? segment.params.engine : (engine || segment.params.engine);

  // Resolve voice display:
  // - Locked segments → always show stored voice
  // - Unlocked + already generated → show the voice used at generation time (stored params)
  // - Unlocked + not yet generated (idle/failed) → show current global voice
  const resolveVoiceDisplay = (): { engine: string; voice: string } => {
    const p = segment.params;
    // For display, use the engine that was active when the segment was generated (if ready),
    // otherwise use the effective (would-be) engine.
    const dispEngine = (isReady || isGenerating) ? p.engine : effectiveEngine;
    const eng = ENGINE_LABELS[dispEngine] || dispEngine;
    const useGlobal = !hasOverride && !isReady && !isGenerating;

    if (dispEngine === 'edge_tts') {
      const ev = useGlobal ? globalEdgeVoice : p.edge_voice;
      if (ev) {
        const parts = ev.split('-');
        const name = (parts[parts.length - 1] || ev).replace(/Neural$|V\d+$/i, '');
        return { engine: eng, voice: name };
      }
      return { engine: eng, voice: '未选择' };
    }

    if (dispEngine === 'mimo_tts') {
      const mode = useGlobal ? globalMimoMode : p.mimo_mode;
      if (mode === 'voiceclone') {
        const cloneId = useGlobal ? globalMimoCloneVoiceId : p.mimo_clone_voice_id;
        return { engine: eng, voice: cloneId ? '自定义音色' : '未选择' };
      }
      // preset mode (default)
      const preset = useGlobal ? globalMimoPresetVoice : p.mimo_preset_voice;
      return { engine: eng, voice: preset || '未选择' };
    }

    // CosyVoice
    const vid = useGlobal ? globalVoiceId : p.voice_id;
    if (vid) {
      const vObj = voices.find(v => (v.qwen_voice_id || v.id) === vid);
      return { engine: eng, voice: vObj?.description || vObj?.name || vid };
    }
    if (!hasOverride && globalVoiceName) return { engine: eng, voice: globalVoiceName };
    return { engine: eng, voice: '未选择' };
  };

  const { engine: displayEngine, voice: voiceDisplayName } = resolveVoiceDisplay();

  // Resolve voice object for gender lookup (from stored params)
  const voiceObj = voices.find(v => (v.qwen_voice_id || v.id) === segment.params.voice_id);

  const resolveGender = (): string => {
    const desc = (voiceObj?.description || voiceObj?.name || '').toLowerCase();
    if (desc.includes('女') || desc.includes('female')) return 'female';
    if (desc.includes('男') || desc.includes('male')) return 'male';
    // For Edge-TTS, check the relevant edge voice name
    if (effectiveEngine === 'edge_tts') {
      const ev = hasOverride ? (segment.params.edge_voice || '') : (globalEdgeVoice || '');
      if (/xiaoxiao|xiaoyi|xiaomeng|xiaomo|xiaorui|xiaoyan|jenny|aria|jane|sara|lisa/i.test(ev)) return 'female';
      return 'male';
    }
    return 'male'; // default
  };
  const voiceGender = resolveGender();

  // ---- Stale detection ----
  // Use the shared helper so role snapshots and prosody marks participate in
  // staleness alongside engine/voice. The helper compares the segment's
  // effective generation inputs against generated_params.

  const generatedEngine = segment.params.engine;

  // Engine changed → stale (unless locked). Kept for the warning label below.
  const engineChanged = !hasOverride && !!generatedEngine && generatedEngine !== effectiveEngine;

  // Resolve the current global voice identifier for comparison (per-engine).
  const currentGlobalVoice = effectiveEngine === 'edge_tts'
    ? (globalEdgeVoice || '')
    : effectiveEngine === 'mimo_tts'
      ? (globalMimoMode === 'voiceclone' ? (globalMimoCloneVoiceId || '') : (globalMimoPresetVoice || ''))
      : (globalVoiceId || '');

  // Effective params that this segment would generate with right now. When the
  // segment has no independent-voice override, fold in the active global voice
  // settings so global changes are detected as stale.
  const defaultParamsForStale = {
    ...segment.params,
    engine: (effectiveEngine || segment.params.engine) as Segment['params']['engine'],
    voice_id: !hasOverride ? globalVoiceId : segment.params.voice_id,
    edge_voice: !hasOverride ? globalEdgeVoice : segment.params.edge_voice,
    mimo_mode: !hasOverride ? (globalMimoMode as Segment['params']['mimo_mode']) : segment.params.mimo_mode,
    mimo_preset_voice: !hasOverride ? globalMimoPresetVoice : segment.params.mimo_preset_voice,
    mimo_clone_voice_id: !hasOverride ? globalMimoCloneVoiceId : segment.params.mimo_clone_voice_id,
  };
  const isStale = segment.generated_params
    ? isSegmentAudioStale(segment, defaultParamsForStale)
    // Legacy / frontend-mode audio without recorded generated_params: fall back
    // to voice/engine comparison so a global voice change is still detected.
    : isSegmentVoiceStale({
        status: segment.status,
        hasVoiceOverride: !!hasOverride,
        generatedEngine,
        effectiveEngine: effectiveEngine as Segment['params']['engine'],
        generatedVoiceId: segment.generated_voice_id,
        currentGlobalVoice,
      });

  // Build a human-readable label for the current global voice (for stale warning text)
  const currentGlobalVoiceLabel = effectiveEngine === 'edge_tts'
    ? (() => {
        const parts = (globalEdgeVoice || '').split('-');
        return (parts[parts.length - 1] || globalEdgeVoice || '').replace(/Neural$|V\d+$/i, '');
      })()
    : effectiveEngine === 'mimo_tts'
      ? (globalMimoMode === 'voiceclone' ? '自定义音色' : (globalMimoPresetVoice || ''))
      : (globalVoiceName || currentGlobalVoice || '');

  const dur = isReady && segment.duration_sec
    ? segment.duration_sec.toFixed(1) + 's'
    : isGenerating ? '...' : '';

  if (layout === 'horizontal') {
    return (
      <div className={`${styles.hBlock} ${styles[`st${segment.status.charAt(0).toUpperCase() + segment.status.slice(1)}`] || ''} ${isSelected ? styles.selH : ''}`}
        onClick={() => onSelect(segment.id)} title={segment.text}
        role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') onSelect(segment.id); }}>
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
        onClick={() => onSelect(segment.id)} role="button" tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter') onSelect(segment.id); }}
      >
        <div className={styles.compactEmo} />
        <div className={styles.compactAvatarWrap}>
          <VoiceAvatar name={voiceDisplayName} size={28} gender={voiceGender} />
        </div>
        <div className={styles.compactVoice}>
          <span className={styles.compactVoiceName}>{voiceDisplayName}</span>
          <span className={styles.compactVoiceEngine}>{displayEngine}</span>
        </div>
        <span className={styles.compactIdx}>#{idx}</span>
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
          <span className={styles.compactStale} title="音色已变更，建议重新生成">⚠</span>
        )}
        {isReady && (
          <button
            className={`${styles.compactVoiceLock} ${useIndependentVoice ? styles.compactVoiceLockActive : ''}`}
            title={useIndependentVoice ? '独立音色（点击跟随全局）' : '跟随全局（点击锁定独立音色）'}
            onClick={(e) => { e.stopPropagation(); onToggleIndependentVoice?.(segment.id); }}
          >
            {useIndependentVoice ? '🔒' : '🔗'}
          </button>
        )}
        {onMerge && (
          <MergeMenu segmentId={segment.id} canUp={index > 1} canDown={!isLast} onMerge={onMerge} compact />
        )}
        {isReady && (
          <button className={styles.compactPlayBtn} title={isPlaying && !isPaused ? '暂停' : '播放'}
            onClick={(e) => { e.stopPropagation(); onPlay(segment.id); }}>
            {isPlaying && !isPaused ? '⏸' : '▶'}
          </button>
        )}
        <button className={styles.compactDelBtn} title="删除" disabled={isGenerating}
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
      onClick={() => onSelect(segment.id)} role="button" tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') onSelect(segment.id); }}
    >
      <div className={styles.avatarCol}>
<VoiceAvatar name={voiceDisplayName} size={48} gender={voiceGender}
          label={voiceDisplayName}
          sublabel={displayEngine} />
        {isSelected && <span className={styles.editingBadge}>编辑中</span>}
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
            ⚠ {engineChanged ? '模型已切换' : '音色已变更'}（当前全局: {ENGINE_LABELS[effectiveEngine] || effectiveEngine}{currentGlobalVoiceLabel ? ` · ${currentGlobalVoiceLabel}` : ''}），建议重新生成
          </div>
        )}

        {/* Time range — subtitle-style timestamp */}
        {timeStart != null && (
          <div className={styles.timeRange}>
            {fmtTime(timeStart)}{timeEnd != null ? ` – ${fmtTime(timeEnd)}` : ' – …'}
          </div>
        )}

        {/* Decorative waveform */}
        {isReady && segment.current_audio_id && (
          <div className={styles.waveDecor}>
            {waveform.map((h, i) => <div key={i} className={styles.wfBar} style={{ height: `${h}%` }} />)}
          </div>
        )}

        {/* Bottom: emotion + voice/model info + actions */}
        <div className={styles.metaRow}>
          <div className={styles.badges}>
            {segment.emotion && (
              <span className={`${styles.emoTag} ${styles[`tag${emoCamel}`]}`}>{EMOTION_LABELS[emotion]}</span>
            )}
            {hasOverride && (
              <button
                className={styles.indVoiceToggle}
                title="点击取消独立音色，跟随全局"
                onClick={(e) => { e.stopPropagation(); onToggleIndependentVoice?.(segment.id); }}
              >
                🔒 独立音色
              </button>
            )}
            {!hasOverride && isReady && (
              <button
                className={styles.indVoiceToggleOff}
                title="点击锁定为独立音色，不再跟随全局"
                onClick={(e) => { e.stopPropagation(); onToggleIndependentVoice?.(segment.id); }}
              >
                🔗 跟随全局
              </button>
            )}
            {isReady && !isStale && <span className={styles.readyMark}>✓</span>}
            {isFailed && <span className={styles.failMark}>✕ {segment.error || ''}</span>}
            {isIdle && <span className={styles.idleText}>待生成</span>}
            {segment.ssml && <span className={styles.ssmlMark}>SSML</span>}
          </div>
          <div className={styles.actions}>
            {/* Generate button for idle/failed */}
            {(isIdle || isFailed) && (
              <button className={isFailed ? styles.genBtnFail : styles.genBtn} disabled={isGenerating}
                onClick={(e) => { e.stopPropagation(); onRegenerate(segment.id); }}>
                {isGenerating ? '⏳' : '▶ 生成'}
              </button>
            )}
            {isGenerating && <span className={styles.genBadge}>⏳</span>}
            {isReady && (
              <button className={styles.actPlay} title={isPlaying && !isPaused ? '暂停' : '播放'}
                onClick={(e) => { e.stopPropagation(); onPlay(segment.id); }}>
                {isPlaying && !isPaused ? '⏸' : '▶'}
              </button>
            )}
            <button className={styles.actBtn} title="编辑"
              onClick={(e) => { e.stopPropagation(); onEdit(segment.id); }}>✎</button>
            {isReady && (
              <button className={styles.actBtn} title="重新生成"
                onClick={(e) => { e.stopPropagation(); onRegenerate(segment.id); }}>↻</button>
            )}
            {isReady && onTrimSilence && (
              <button className={styles.actBtn} title="裁剪静音"
                onClick={(e) => { e.stopPropagation(); onTrimSilence(segment.id); }}>✂</button>
            )}
            {onMerge && (
              <MergeMenu segmentId={segment.id} canUp={index > 1} canDown={!isLast} onMerge={onMerge} />
            )}
            <button className={styles.actBtnDanger} title="删除" disabled={isGenerating}
              onClick={(e) => { e.stopPropagation(); onDelete(segment.id); }}>✕</button>
          </div>
        </div>
      </div>
    </div>
  );
}
