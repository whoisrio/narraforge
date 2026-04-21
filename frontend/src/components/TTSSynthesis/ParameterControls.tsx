import type { TTSRequest } from '../../types';
import styles from './ParameterControls.module.css';

interface ParameterControlsProps {
  params: Partial<TTSRequest>;
  onParamChange: (params: Partial<TTSRequest>) => void;
}

const LANGUAGE_OPTIONS = [
  { value: 'Chinese', label: '中文' },
  { value: 'English', label: 'English' },
  { value: 'Japanese', label: '日本語' },
  { value: 'Korean', label: '한국어' },
] as const;

const EMOTION_OPTIONS = [
  { value: undefined, label: '默认' },
  { value: 'neutral', label: '平静' },
  { value: 'happy', label: '开心' },
  { value: 'sad', label: '悲伤' },
  { value: 'nervous', label: '紧张' },
  { value: 'excited', label: '激动' },
] as const;

export function ParameterControls({ params, onParamChange }: ParameterControlsProps) {
  return (
    <div className={styles.container}>
      <h3>参数设置</h3>

      <div className={styles.controls}>
        {/* Language */}
        <div className={styles.control}>
          <label htmlFor="language">语言</label>
          <select
            id="language"
            value={params.language || 'Chinese'}
            onChange={(e) => onParamChange({ ...params, language: e.target.value as any })}
          >
            {LANGUAGE_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        {/* Speed */}
        <div className={styles.control}>
          <label htmlFor="speed">语速: {(params.speed ?? 1.0).toFixed(1)}x</label>
          <input
            id="speed"
            type="range"
            min="0.5"
            max="2.0"
            step="0.1"
            role="slider"
            aria-label="语速"
            value={params.speed ?? 1.0}
            onChange={(e) => onParamChange({ ...params, speed: parseFloat(e.target.value) })}
          />
        </div>

        {/* Volume */}
        <div className={styles.control}>
          <label htmlFor="volume">音量: {params.volume ?? 80}</label>
          <input
            id="volume"
            type="range"
            min="0"
            max="100"
            step="1"
            role="slider"
            aria-label="音量"
            value={params.volume ?? 80}
            onChange={(e) => onParamChange({ ...params, volume: parseInt(e.target.value) })}
          />
        </div>

        {/* Pitch */}
        <div className={styles.control}>
          <label htmlFor="pitch">语调: {params.pitch ?? 0}</label>
          <input
            id="pitch"
            type="range"
            min="-12"
            max="12"
            step="1"
            role="slider"
            aria-label="语调"
            value={params.pitch ?? 0}
            onChange={(e) => onParamChange({ ...params, pitch: parseInt(e.target.value) })}
          />
        </div>

        {/* Emotion */}
        <div className={styles.control}>
          <label htmlFor="emotion">语气</label>
          <select
            id="emotion"
            value={params.emotion ?? 'default'}
            onChange={(e) => {
              const value = e.target.value === 'default' ? undefined : e.target.value as any;
              onParamChange({ ...params, emotion: value });
            }}
          >
            {EMOTION_OPTIONS.map(opt => (
              <option key={opt.value ?? 'default'} value={opt.value ?? 'default'}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
