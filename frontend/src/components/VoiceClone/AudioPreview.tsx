import { useState } from 'react';
import { voiceApi } from '../../services/api';
import styles from './AudioPreview.module.css';

interface AudioPreviewProps {
  file: File;
  onCloneSuccess: () => void;
  onCancel: () => void;
}

/** 录音/上传完成后展示音频预览，依次执行 upload → clone，失败则回滚删除 */
export function AudioPreview({ file, onCloneSuccess, onCancel }: AudioPreviewProps) {
  const [isCloning, setIsCloning] = useState(false);
  const [step, setStep] = useState<'idle' | 'uploading' | 'cloning'>('idle');
  const [error, setError] = useState('');
  /** 暂存 upload 返回的 voice_id，用于 clone 或回滚 */
  const [uploadedVoiceId, setUploadedVoiceId] = useState<string | null>(null);

  const audioUrl = URL.createObjectURL(file);

  /** 两步流程：上传文件 → 注册克隆。失败则回滚删除上传记录 */
  const handleClone = async () => {
    setIsCloning(true);
    setError('');

    try {
      // Step 1: 上传音频文件
      setStep('uploading');
      const uploadResult = await voiceApi.upload(file);
      setUploadedVoiceId(uploadResult.id);

      // Step 2: 调用千问注册克隆
      setStep('cloning');
      await voiceApi.createClone(uploadResult.id);

      // 全部成功，通知父组件
      URL.revokeObjectURL(audioUrl);
      onCloneSuccess();
    } catch (err) {
      console.error('Clone failed:', err);

      // 失败回滚：删除已上传的 voice 记录
      if (uploadedVoiceId) {
        try {
          await voiceApi.delete(uploadedVoiceId);
        } catch (rollbackErr) {
          console.error('Rollback failed:', rollbackErr);
        }
      }
      setError('克隆失败，已回滚上传。请重试');
      setStep('idle');
      setUploadedVoiceId(null);
    } finally {
      setIsCloning(false);
    }
  };

  const handleCancel = () => {
    URL.revokeObjectURL(audioUrl);
    // 如果已上传但未完成 clone，也需要删除
    if (uploadedVoiceId) {
      voiceApi.delete(uploadedVoiceId).catch(e => console.error('Cleanup failed:', e));
    }
    onCancel();
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <span className={styles.label}>待处理音频</span>
        {step !== 'idle' && (
          <span className={styles.stepIndicator}>
            {step === 'uploading' ? '上传中...' : '克隆注册中...'}
          </span>
        )}
      </div>

      <div className={styles.fileInfo}>
        <span className={styles.fileIcon}>📁</span>
        <span className={styles.fileName}>{file.name}</span>
        <span className={styles.fileSize}>{(file.size / 1024).toFixed(1)} KB</span>
      </div>

      <audio className={styles.audioPlayer} src={audioUrl} controls />

      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.actions}>
        <button
          className={styles.cloneButton}
          onClick={handleClone}
          disabled={isCloning}
        >
          {isCloning ? (step === 'uploading' ? '上传中...' : '克隆注册中...') : 'Clone Voice'}
        </button>
        <button
          className={styles.cancelButton}
          onClick={handleCancel}
          disabled={isCloning}
        >
          取消
        </button>
      </div>
    </div>
  );
}