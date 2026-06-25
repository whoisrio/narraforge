import { Select } from '../ui/Select';
import { Slider } from '../ui/Slider';
import styles from './SidebarConfig.module.css';

interface SidebarConfigProps {
  engine: string;
  modelSize: string;
  beamSize: number;
  enableVad: boolean;
  engineOptions: { value: string; label: string }[];
  whisperModelOptions: { value: string; label: string }[];
  funasrModelOptions: { value: string; label: string }[];
  onEngineChange: (engine: string) => void;
  onModelSizeChange: (size: string) => void;
  onBeamSizeChange: (size: number) => void;
  onEnableVadChange: (enabled: boolean) => void;
}

export function SidebarConfig({
  engine, modelSize, beamSize, enableVad,
  engineOptions, whisperModelOptions, funasrModelOptions,
  onEngineChange, onModelSizeChange, onBeamSizeChange, onEnableVadChange,
}: SidebarConfigProps) {
  return (
    <div className={styles.card}>
      <h3 className={styles.cardTitle}>
        <span className="material-symbols-outlined">tune</span>
        Engine Config
      </h3>
      <div className={styles.field}>
        <Select
          label="识别引擎"
          options={engineOptions}
          value={engine}
          onChange={(e) => onEngineChange(e.target.value)}
        />
      </div>
      <div className={styles.field}>
        <Select
          label="模型大小"
          options={engine === 'whisper' ? whisperModelOptions : funasrModelOptions}
          value={modelSize}
          onChange={(e) => onModelSizeChange(e.target.value)}
        />
      </div>
      {engine === 'whisper' && (
        <div className={styles.field}>
          <Slider
            label="Beam Size"
            value={beamSize}
            onChange={onBeamSizeChange}
            min={1}
            max={10}
            step={1}
          />
        </div>
      )}
      {engine === 'funasr' && (
        <label className={styles.checkbox}>
          <input
            type="checkbox"
            checked={enableVad}
            onChange={(e) => onEnableVadChange(e.target.checked)}
          />
          启用 VAD (语音活动检测)
        </label>
      )}
    </div>
  );
}
