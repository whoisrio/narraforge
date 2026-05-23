import { useState } from 'react';
import styles from './EdgeTTSParameterControls.module.css';

interface EdgeTTSParameterControlsProps {
  rate: number;
  volume: number;
  onRateChange: (rate: number) => void;
  onVolumeChange: (volume: number) => void;
}

function toEdgeFormat(value: number) {
  return value >= 0 ? `+${value}%` : `${value}%`;
}

/** Edge-TTS 参数设置：语速和音量，默认收起 */
export function EdgeTTSParameterControls({
  rate,
  volume,
  onRateChange,
  onVolumeChange,
}: EdgeTTSParameterControlsProps) {
  const [collapsed, setCollapsed] = useState(true);

  return (
    <div className={styles.container}>
      <button
        type="button"
        className={styles.header}
        onClick={() => setCollapsed(!collapsed)}
        aria-expanded={!collapsed}
      >
        <span>参数设置</span>
        <span className={styles.arrow}>{collapsed ? '展开' : '收起'}</span>
      </button>

      {!collapsed && (
        <div className={styles.controls}>
          <div className={styles.param}>
            <label>语速: {toEdgeFormat(rate)}</label>
            <input
              type="range"
              min={-50}
              max={100}
              step={5}
              value={rate}
              onChange={(e) => onRateChange(parseInt(e.target.value))}
            />
          </div>
          <div className={styles.param}>
            <label>音量: {toEdgeFormat(volume)}</label>
            <input
              type="range"
              min={-50}
              max={100}
              step={5}
              value={volume}
              onChange={(e) => onVolumeChange(parseInt(e.target.value))}
            />
          </div>
        </div>
      )}
    </div>
  );
}