import { useTranslation } from '../../i18n';
import { Select } from '../ui/Select';
import { Slider } from '../ui/Slider';
import styles from './SidebarConfig.module.css';

interface SidebarConfigProps {
  engine: string;
  modelSize: string;
  beamSize: number;
  enableVad: boolean;
  engineOptions: { value: string; labelKey: string }[];
  whisperModelOptions: { value: string; labelKey: string }[];
  funasrModelOptions: { value: string; labelKey: string }[];
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
  const { t } = useTranslation();

  const translateOptions = (options: { value: string; labelKey: string }[]) =>
    options.map(opt => ({ value: opt.value, label: t(opt.labelKey) }));

  return (
    <div className={styles.card}>
      <h3 className={styles.cardTitle}>
        <span className="material-symbols-outlined">tune</span>
        {t('transcriptionConfig.title')}
      </h3>
      <div className={styles.field}>
        <Select
          label={t('transcriptionConfig.engine')}
          options={translateOptions(engineOptions)}
          value={engine}
          onChange={(e) => onEngineChange(e.target.value)}
        />
      </div>
      <div className={styles.field}>
        <Select
          label={t('transcriptionConfig.modelSize')}
          options={
            engine === 'whisper'
              ? translateOptions(whisperModelOptions)
              : translateOptions(funasrModelOptions)
          }
          value={modelSize}
          onChange={(e) => onModelSizeChange(e.target.value)}
        />
      </div>
      {engine === 'whisper' && (
        <div className={styles.field}>
          <Slider
            label={t('transcriptionConfig.beamSize')}
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
          {t('transcriptionConfig.enableVad')}
        </label>
      )}
    </div>
  );
}
