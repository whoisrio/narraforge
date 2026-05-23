import { useState } from 'react';
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
  { value: '', label: '默认' },
  { value: 'neutral', label: '平静' },
  { value: 'happy', label: '开心' },
  { value: 'sad', label: '悲伤' },
  { value: 'nervous', label: '紧张' },
  { value: 'excited', label: '激动' },
] as const;

export function ParameterControls({ params, onParamChange }: ParameterControlsProps) {
  const [collapsed, setCollapsed] = useState(true);

  return (
    <div className={styles.container}>
      {/* 头部栏：始终显示，点击切换折叠状态 */}
      <button
        type="button"
        className={styles.header}
        onClick={() => setCollapsed(!collapsed)}
        aria-expanded={!collapsed}
      >
        <span>参数设置</span>
        <span className={styles.arrow}>{collapsed ? '展开' : '收起'}</span>
      </button>

      {/* 控件面板：折叠时隐藏，展开后参数值不受折叠影响 */}
      {!collapsed && (
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
            <label htmlFor="pitch">语调: {(params.pitch ?? 1.0).toFixed(1)}</label>
            <input
              id="pitch"
              type="range"
              min="0.5"
              max="2.0"
              step="0.1"
              role="slider"
              aria-label="语调"
              value={params.pitch ?? 1.0}
              onChange={(e) => onParamChange({ ...params, pitch: parseFloat(e.target.value) })}
            />
          </div>

          {/* Emotion */}
          <div className={styles.control}>
            <label htmlFor="emotion">语气</label>
            <select
              id="emotion"
              value={params.emotion || ''}
              onChange={(e) => {
                const value = e.target.value || undefined;
                onParamChange({ ...params, emotion: value as any });
              }}
            >
              {EMOTION_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        </div>
      )}
    </div>
  );
}