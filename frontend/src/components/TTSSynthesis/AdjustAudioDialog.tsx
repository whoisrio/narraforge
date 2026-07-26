import { useState } from 'react';
import { useTranslation } from '../../i18n';
import type { AudioAdjustRecord } from '../../types';
import styles from './AdjustAudioDialog.module.css';

interface AdjustAudioDialogProps {
  /** 受影响的 ready 段数 */
  readyCount: number;
  /** 本章已应用的调整参数（有记录时滑块回显，且允许恒等提交即还原） */
  currentAdjust?: AudioAdjustRecord | null;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (tempo: number, volumeDb: number) => void;
}

/**
 * 合成后音频调整（速度/音量）：ffmpeg atempo + volume 批处理章节内已生成音频。
 * 绝对语义：始终以原始音频为基准渲染；调回 1.0x/0dB 即还原。
 */
export function AdjustAudioDialog({ readyCount, currentAdjust, busy, onCancel, onConfirm }: AdjustAudioDialogProps) {
  const { t } = useTranslation();
  const [tempo, setTempo] = useState(currentAdjust?.tempo ?? 1.0);
  const [volumeDb, setVolumeDb] = useState(currentAdjust?.volume_db ?? 0);
  const identity = Math.abs(tempo - 1) < 1e-9 && volumeDb === 0;
  const hasRecord = !!currentAdjust;
  const unchanged = hasRecord
    && Math.abs(tempo - currentAdjust.tempo) < 1e-9
    && volumeDb === currentAdjust.volume_db;
  const canApply = !busy && readyCount > 0 && !unchanged && (hasRecord || !identity);

  return (
    <div className={styles.overlay} role="dialog" aria-label={t('adjustAudio.title')}>
      <section className={styles.card}>
        <header className={styles.header}>
          <h3>{t('adjustAudio.title')}</h3>
          <button type="button" onClick={onCancel} aria-label={t('common.close')}>×</button>
        </header>
        <div className={styles.body}>
          <p className={styles.affected}>{t('adjustAudio.affected', { count: readyCount })}</p>
          {hasRecord && (
            <p className={styles.current}>
              {t('adjustAudio.current', {
                tempo: currentAdjust.tempo,
                volume: currentAdjust.volume_db > 0 ? `+${currentAdjust.volume_db}` : currentAdjust.volume_db,
              })}
            </p>
          )}
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
            disabled={!canApply}
            onClick={() => onConfirm(tempo, volumeDb)}
          >
            {busy ? t('adjustAudio.applying') : identity && hasRecord ? t('adjustAudio.revert') : t('adjustAudio.apply')}
          </button>
        </footer>
      </section>
    </div>
  );
}
