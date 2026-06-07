import { useState, useEffect, useRef } from 'react';
import type { Segment, EmotionType, VoiceProfile } from '../../types';
import { VoiceAvatar } from '../ui/VoiceAvatar';
import styles from './SegmentRow.module.css';

interface SegmentRowProps {
  segment: Segment;
  index: number;
  isSelected: boolean;
  isPlaying: boolean;
  isPaused: boolean;
  voices: VoiceProfile[];
  globalVoiceId?: string;
  globalVoiceName?: string;
  globalEdgeVoice?: string;
  layout: 'vertical' | 'horizontal';
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
  segment, index, isSelected, isPlaying, isPaused, voices, globalVoiceId, globalVoiceName, globalEdgeVoice,
  layout, onSelect, onDelete, onEdit, onRegenerate, onPlay, onTrimSilence, onUndo,
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
  const idx = String(index).padStart(2, '0');
  const waveform = getWaveform(segment.id);

  // Resolve voice display — handles all engines
  const resolveVoiceDisplay = (): { engine: string; voice: string } => {
    const p = segment.params;
    const eng = ENGINE_LABELS[p.engine] || p.engine;

    if (p.engine === 'edge_tts') {
      const ev = hasOverride ? p.edge_voice : (p.edge_voice || undefined);
      if (ev) {
        // Clean up: "zh-CN-XiaoxiaoNeural" -> "Xiaoxiao", "en-US-JennyNeural" -> "Jenny"
        const parts = ev.split('-');
        const name = (parts[parts.length - 1] || ev).replace(/Neural$|V\d+$/i, '');
        return { engine: eng, voice: name };
      }
      // Fallback: clean up global edge voice
      if (globalEdgeVoice) {
        const parts = globalEdgeVoice.split('-');
        const name = (parts[parts.length - 1] || globalEdgeVoice).replace(/Neural$|V\d+$/i, '');
        return { engine: eng, voice: name };
      }
      return { engine: eng, voice: '未选择' };
    }

    if (p.engine === 'mimo_tts') {
      const voice = p.mimo_preset_voice || (p.mimo_clone_voice_id ? '自定义音色' : '未选择');
      return { engine: eng, voice };
    }

    // CosyVoice
    const vid = hasOverride ? p.voice_id : (p.voice_id || undefined);
    if (vid) {
      const vObj = voices.find(v => (v.qwen_voice_id || v.id) === vid);
      return { engine: eng, voice: vObj?.description || vObj?.name || vid };
    }
    if (globalVoiceName) return { engine: eng, voice: globalVoiceName };
    return { engine: eng, voice: '未选择' };
  };
  const { engine: displayEngine, voice: voiceDisplayName } = resolveVoiceDisplay();

  // Resolve gender for avatar selection
  // Resolve voice object for gender lookup
  const voiceObj = voices.find(v => (v.qwen_voice_id || v.id) === segment.params.voice_id);

  const resolveGender = (): string => {
    const desc = (voiceObj?.description || voiceObj?.name || '').toLowerCase();
    if (desc.includes('女') || desc.includes('female')) return 'female';
    if (desc.includes('男') || desc.includes('male')) return 'male';
    // For Edge-TTS, check the edge_voice name
    if (segment.params.engine === 'edge_tts') {
      const ev = segment.params.edge_voice || '';
      // Common female Edge-TTS voice names
      if (/xiaoxiao|xiaoyi|xiaomeng|xiaomo|xiaorui|xiaoyan|jenny|aria|jane|sara|lisa/i.test(ev)) return 'female';
      return 'male';
    }
    return 'male'; // default
  };
  const voiceGender = resolveGender();

  // For stale detection: compare generated voice with current global
  const currentGlobalVoice = segment.params.engine === 'edge_tts'
    ? (globalEdgeVoice || '')
    : (globalVoiceId || '');
  const isStale = isReady
    && !hasOverride
    && !!segment.generated_voice_id
    && !!currentGlobalVoice
    && segment.generated_voice_id !== currentGlobalVoice;

  const dur = isReady && segment.duration_sec
    ? segment.duration_sec.toFixed(1) + 's'
    : isGenerating ? '...' : '';

  if (layout === 'horizontal') {
    return (
      <div className={`${styles.hBlock} ${styles[`st${segment.status.charAt(0).toUpperCase() + segment.status.slice(1)}`] || ''} ${isSelected ? styles.selH : ''}`}
        onClick={() => onSelect(segment.id)} title={segment.text}
        role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') onSelect(segment.id); }}>
        <span className={styles.hIdx}>#{idx}</span>
        <span className={styles.hDur}>{dur || '—'}</span>
        <span className={styles.hTxt}>{segment.text.slice(0, 8)}{segment.text.length > 8 ? '…' : ''}</span>
      </div>
    );
  }

  const renderText = () => {
    if (charIdx < 0) return <span className={styles.txt}>{segment.text}</span>;
    return (
      <span className={styles.txt}>
        {segment.text.split('').map((c, i) => (
          <span key={i} className={i <= charIdx ? styles.charLit : styles.charDim}>{c}</span>
        ))}
      </span>
    );
  };

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
            ⚠ 音色已变更（当前全局: {globalVoiceName}），此段音频使用的是旧音色，建议重新生成
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
              <span className={styles.overrideBadge}>🔊 覆盖</span>
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
            <button className={styles.actBtnDanger} title="删除" disabled={isGenerating}
              onClick={(e) => { e.stopPropagation(); onDelete(segment.id); }}>✕</button>
          </div>
        </div>
      </div>
    </div>
  );
}
