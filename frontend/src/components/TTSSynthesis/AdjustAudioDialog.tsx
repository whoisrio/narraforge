import { useState } from 'react';
import { useTranslation } from '../../i18n';
import styles from './AdjustAudioDialog.module.css';

interface AdjustAudioDialogProps {
  /** 受影响的 ready 段数 */
  readyCount: number;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (tempo: number, volumeDb: number) => void;
}

/**
 * 合成后音频调整（速度/音量）：ffmpeg atempo + volume 批处理章节内已生成音频。
 * 旧音频自动保留为 previous，可撤销。
 */
export function AdjustAudioDialog({ readyCount, busy, onCancel, onConfirm }: AdjustAudioDialogProps) {
  const { t } = useTranslation();
  const [tempo, setTempo] = useState(1.0);
  const [volumeDb, setVolumeDb] = useState(0);
  const identity = Math.abs(tempo - 1) < 1e-9 && volumeDb === 0;

  return (
    <div className={styles.overlay} role="dialog" aria-label={t('adjustAudio.title')}>
      <section className={styles.card}>
        <header className={styles.header}>
          <h3>{t('adjustAudio.title')}</h3>
          <button type="button" onClick={onCancel} aria-label={t('common.close')}>×</button>
        </header>
        <div className={styles.body}>
          <p className={styles.affected}>{t('adjustAudio.affected', { count: readyCount })}</p>
          <label className={styles.field}>
            <span>{t('adjustAudio.tempo')}: <strong>{tempo.toFixed(2)}×</strong></span>
            <input
              type="range"
              min={0.5}
              max={2}
              step={0.05}
              value={tempo}
              onChange={(e) => setTempo(Number(e.target.value))}
              aria-label={t('adjustAudio.tempo')}
            />
          </label>
          <label className={styles.field}>
            <span>{t('adjustAudio.volume')}: <strong>{volumeDb > 0 ? `+${volumeDb}` : volumeDb} dB</strong></span>
            <input
              type="range"
              min={-12}
              max={12}
              step={1}
              value={volumeDb}
              onChange={(e) => setVolumeDb(Number(e.target.value))}
              aria-label={t('adjustAudio.volume')}
            />
          </label>
          <p className={styles.hint}>{t('adjustAudio.hint')}</p>
        </div>
        <footer className={styles.footer}>
          <button type="button" className={styles.ghostBtn} onClick={onCancel}>{t('common.cancel')}</button>
          <button
            type="button"
            className={styles.primaryBtn}
            disabled={busy || identity || readyCount === 0}
            onClick={() => onConfirm(tempo, volumeDb)}
          >
            {busy ? t('adjustAudio.applying') : t('adjustAudio.apply')}
          </button>
        </footer>
      </section>
    </div>
  );
}
