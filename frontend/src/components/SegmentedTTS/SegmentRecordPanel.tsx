import { useEffect, useRef, useState } from 'react';
import { useTranslation } from '../../i18n';
import { useConfirm } from '../ui/useConfirm';
import { Modal } from '../ui/Modal';
import { Button } from '../ui';
import { AudioRecorder } from '../VoiceClone/AudioRecorder';
import styles from './SegmentRecordPanel.module.css';

interface SegmentRecordPanelProps {
  /** 片段文本（仅用于展示上下文） */
  segmentText: string;
  /** 片段是否已有音频（TTS 或之前的录入）—— 确认前需覆盖警告 */
  hasExistingAudio: boolean;
  busy?: boolean;
  /** 确认使用录入音频；durationSec 可能为 undefined（解码失败时） */
  onConfirm: (audio: File | Blob, durationSec?: number) => void | Promise<void>;
  onClose: () => void;
}

/** 用 AudioContext 解码音频时长；失败（如容器格式不支持）时返回 undefined */
async function decodeDuration(blob: Blob): Promise<number | undefined> {
  try {
    const ac = new AudioContext();
    const ab = await ac.decodeAudioData(await blob.arrayBuffer());
    const duration = ab.duration;
    ac.close();
    return duration;
  } catch (e) {
    console.warn('[SegmentRecordPanel] decode duration failed:', e);
    return undefined;
  }
}

export function SegmentRecordPanel({ segmentText, hasExistingAudio, busy, onConfirm, onClose }: SegmentRecordPanelProps) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const [pending, setPending] = useState<{ blob: Blob; url: string } | null>(null);
  const urlRef = useRef<string | null>(null);

  // 维护预览 objectURL 生命周期：替换时回收旧的，卸载时回收当前的
  useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);

  const setPendingBlob = (blob: Blob | null) => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    if (!blob) { urlRef.current = null; setPending(null); return; }
    const url = URL.createObjectURL(blob);
    urlRef.current = url;
    setPending({ blob, url });
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setPendingBlob(file);
    // 允许重复选择同一文件
    e.target.value = '';
  };

  const handleConfirm = async () => {
    if (!pending || busy) return;
    if (hasExistingAudio) {
      const ok = await confirm({
        title: t('segment.segmentRecord.overwriteConfirmTitle'),
        message: t('segment.segmentRecord.overwriteConfirmMessage'),
        variant: 'warning',
      });
      if (!ok) return;
    }
    const durationSec = await decodeDuration(pending.blob);
    await onConfirm(pending.blob, durationSec);
  };

  return (
    <Modal isOpen onClose={onClose} title={t('segment.segmentRecord.panelTitle')}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
          <Button onClick={handleConfirm} disabled={!pending || busy}>{t('segment.segmentRecord.useAudio')}</Button>
        </>
      )}
    >
      <div className={styles.body}>
        <p className={styles.segmentText} title={segmentText}>{segmentText}</p>
        <AudioRecorder onRecordComplete={(file) => setPendingBlob(file)} />
        <div className={styles.uploadRow}>
          <span className={styles.uploadOr}>{t('segment.segmentRecord.uploadOr')}</span>
          <label className={styles.fileLabel}>
            {t('segment.segmentRecord.chooseFile')}
            <input type="file" accept="audio/*" className={styles.fileInput} onChange={handleFileChange} />
          </label>
        </div>
        {pending && (
          <div className={styles.previewRow}>
            <span className={styles.previewLabel}>{t('segment.segmentRecord.preview')}</span>
            <audio controls src={pending.url} className={styles.previewAudio} />
          </div>
        )}
      </div>
    </Modal>
  );
}
