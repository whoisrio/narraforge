import { useState } from 'react';
import { voiceApi } from '../../services/api';
import { useTranslation } from '../../i18n';
import { ImageUploadZone } from '../ui/ImageUploadZone';
import styles from './AudioPreview.module.css';

interface AudioPreviewProps {
  /** 文件模式：用户录制/上传的 File，组件负责 upload → clone */
  file?: File;
  /** URL 模式：已经通过 upload-from-url 创建好的 voice ID，跳过上传直接 clone */
  voiceId?: string;
  /** URL 模式下用于预览播放的音频地址 */
  audioUrl?: string;
  /** 复刻引擎：qwen（千问CosyVoice）、mimo（MiMo TTS）或 voxcpm（本地GPU） */
  engine?: 'qwen' | 'mimo' | 'voxcpm';
  /** 项目 ID，传入时创建的声音归属该项目 */
  projectId?: string;
  /** 引擎参数，克隆时写入 VoiceProfile.engine_params */
  engineParams?: Record<string, unknown>;
  onCloneSuccess: () => void;
  onCancel: () => void;
}

/** 录音/上传完成后展示音频预览，依次执行 upload → clone（失败则回滚删除）。URL 模式下跳过 upload 直接 clone */
export function AudioPreview({ file, voiceId, audioUrl, engine = 'qwen', projectId, engineParams, onCloneSuccess, onCancel }: AudioPreviewProps) {
  const { t } = useTranslation();
  const [isCloning, setIsCloning] = useState(false);
  const [step, setStep] = useState<'idle' | 'uploading' | 'cloning'>('idle');
  const [error, setError] = useState('');
  /** 暂存 upload 返回的 voice_id，用于 clone 或回滚（仅文件模式） */
  const [uploadedVoiceId, setUploadedVoiceId] = useState<string | null>(null);
  /** VoxCPM 模式下的参考音频文本 */
  const [promptText, setPromptText] = useState('');
  /** 音色名称和头像 */
  const [voiceName, setVoiceName] = useState('');
  const [voiceAvatar, setVoiceAvatar] = useState<string | null>(null);

  /** 文件模式下用于播放的本地 blob URL */
  const blobUrl = file ? URL.createObjectURL(file) : null;
  /** 实际用于播放的音频地址 */
  const playUrl = audioUrl || blobUrl || '';

  /** 两步流程：上传（文件模式）→ 注册克隆。失败则回滚 */
  const handleClone = async () => {
    setIsCloning(true);
    setError('');

    let targetVoiceId: string;

    try {
      if (voiceId) {
        // URL 模式：已有 voice_id，直接克隆，无需回滚（由 UrlInput 创建）
        targetVoiceId = voiceId;
        setStep('cloning');
      } else if (file) {
        // 文件模式：先上传再克隆（现有逻辑）
        setStep('uploading');
        const uploadResult = await voiceApi.upload(file, engine === 'voxcpm' ? promptText : undefined, projectId);
        targetVoiceId = uploadResult.id;
        setUploadedVoiceId(targetVoiceId);
        setStep('cloning');
      } else {
        setError(t('audioPreview.missingAudioData'));
        return;
      }

      // 根据引擎选择不同的克隆 API
      const name = voiceName.trim() || undefined;
      const avatar = voiceAvatar || undefined;
      if (engine === 'mimo') {
        await voiceApi.createCloneMiMo(targetVoiceId, name, avatar, projectId, engineParams);
      } else if (engine === 'voxcpm') {
        await voiceApi.createCloneVoxCPM(targetVoiceId, name, avatar, projectId, engineParams);
      } else {
        await voiceApi.createClone(targetVoiceId, name, avatar, projectId, engineParams);
      }

      // 成功，清理 blob URL 并通知父组件
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl);
      }
      onCloneSuccess();
    } catch (err) {
      console.error('Clone failed:', err);

      // 文件模式：失败回滚删除已上传的记录
      if (uploadedVoiceId && !voiceId) {
        try {
          await voiceApi.delete(uploadedVoiceId);
        } catch (rollbackErr) {
          console.error('Rollback failed:', rollbackErr);
        }
      }
      setError(engine === 'mimo' ? t('audioPreview.cloneFailedMiMo') : engine === 'voxcpm' ? t('audioPreview.cloneFailedVoxCPM') : t('audioPreview.cloneFailed'));
      setStep('idle');
    } finally {
      setIsCloning(false);
    }
  };

  const handleCancel = () => {
    if (blobUrl) {
      URL.revokeObjectURL(blobUrl);
    }
    // 如果已上传但未完成 clone（文件模式），也需要删除
    if (uploadedVoiceId && !voiceId) {
      voiceApi.delete(uploadedVoiceId).catch(e => console.error('Cleanup failed:', e));
    }
    onCancel();
  };

  const engineLabel = engine === 'mimo' ? 'MiMo-TTS' : engine === 'voxcpm' ? 'VoxCPM' : 'CosyVoice';
  /** VoxCPM 模式下，prompt_text 为空时禁用克隆按钮 */
  const canClone = engine === 'voxcpm' ? promptText.trim().length > 0 : true;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <span className={styles.label}>{t('audioPreview.pendingAudio')}</span>
        {step !== 'idle' && (
          <span className={styles.stepIndicator}>
            {step === 'uploading' ? t('audioPreview.uploading') : t('audioPreview.cloning', { engine: engineLabel })}
          </span>
        )}
      </div>

      <div className={styles.fileInfo}>
        <span className={styles.fileName}>
          {voiceId ? t('audioPreview.externalAudio') : file?.name}
        </span>
        {file && (
          <span className={styles.fileSize}>{(file.size / 1024).toFixed(1)} KB</span>
        )}
      </div>

      {playUrl && (
        <audio className={styles.audioPlayer} src={playUrl} controls />
      )}

      {/* 音色名称和头像 */}
      <div className={styles.identityRow}>
        <ImageUploadZone
          value={voiceAvatar}
          onChange={(dataUrl) => setVoiceAvatar(dataUrl)}
          size="sm"
        />
        <div className={styles.identityFields}>
          <label className={styles.fieldLabel}>
            {t('audioPreview.voiceNameLabel')}
            <input
              className={styles.fieldInput}
              value={voiceName}
              onChange={e => setVoiceName(e.target.value)}
              placeholder={file?.name?.replace(/\.[^.]+$/, '') || t('audioPreview.voiceNamePlaceholder')}
            />
          </label>
        </div>
      </div>

      {/* VoxCPM 模式：填写参考音频文本 */}
      {engine === 'voxcpm' && (
        <div className={styles.promptSection}>
          <label className={styles.promptLabel}>{t('audioPreview.promptTextLabel')}</label>
          <textarea
            className={styles.promptTextarea}
            value={promptText}
            onChange={e => setPromptText(e.target.value)}
            placeholder={t('audioPreview.promptTextPlaceholder')}
            rows={3}
          />
          <span className={styles.promptHint}>
            {t('audioPreview.promptTextHint')}
          </span>
        </div>
      )}

      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.actions}>
        <button
          className={styles.cloneButton}
          onClick={handleClone}
          disabled={isCloning || !canClone}
        >
          {isCloning
            ? (step === 'uploading' ? t('audioPreview.uploading') : t('audioPreview.cloning', { engine: engineLabel }))
            : t('audioPreview.cloneWith', { engine: engineLabel })}
        </button>
        <button
          className={styles.cancelButton}
          onClick={handleCancel}
          disabled={isCloning}
        >
          {t('audioPreview.cancel')}
        </button>
      </div>
    </div>
  );
}
