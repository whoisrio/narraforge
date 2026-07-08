import { useState } from 'react';
import { voiceApi } from '../../services/api';
import { useTranslation } from '../../i18n';
import type { VoiceProfile } from '../../types';
import styles from './UrlInput.module.css';

interface UrlInputProps {
  /** URL 确认完成后回调，传递后端创建好的声音记录 */
  onUrlConfirmed: (voice: VoiceProfile) => void;
  /** 用户点击返回 */
  onBack: () => void;
  /** 项目 ID，传入时创建的声音归属该项目 */
  projectId?: string;
}

function getErrorDetail(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null) {
    const response = (error as { response?: { data?: { detail?: unknown } } }).response;
    if (typeof response?.data?.detail === 'string') return response.data.detail;
  }
  return fallback;
}

/**
 * 公网 URL 音频输入组件
 *
 * 用户输入公网可访问的音频 URL，确认后调用后端 upload-from-url 接口。
 * 后端负责：HEAD 校验 URL 可达性 → 下载音频到 uploads 目录 → 保存 external_audio_url。
 */
export function UrlInput({ onUrlConfirmed, onBack, projectId }: UrlInputProps) {
  const { t } = useTranslation();
  const [url, setUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleConfirm = async () => {
    const trimmed = url.trim();
    if (!trimmed) {
      setError(t('urlInput.emptyUrl'));
      return;
    }

    // 前端基础格式校验，真正的可达性由后端 HEAD 请求验证
    try {
      new URL(trimmed);
    } catch {
      setError(t('urlInput.invalidUrl'));
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const result = await voiceApi.uploadFromUrl(trimmed, undefined, undefined, projectId);
      onUrlConfirmed(result);
    } catch (err: unknown) {
      const msg = getErrorDetail(err, t('urlInput.downloadFailed'));
      setError(t('urlInput.confirmFailed', { message: msg }));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={styles.container}>
      <input
        className={styles.urlInput}
        type="url"
        placeholder={t('urlInput.placeholder')}
        value={url}
        onChange={(e) => { setUrl(e.target.value); setError(''); }}
        onKeyDown={(e) => e.key === 'Enter' && handleConfirm()}
        disabled={isLoading}
      />

      {error && <span className={styles.error}>{error}</span>}

      <div className={styles.hint}>
        {t('urlInput.hint')}
      </div>

      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <button
          className={styles.confirmButton}
          onClick={handleConfirm}
          disabled={isLoading || !url.trim()}
        >
          {isLoading ? t('urlInput.validating') : t('urlInput.confirm')}
        </button>
        <button
          className={styles.confirmButton}
          style={{ background: 'var(--color-text-muted)' }}
          onClick={onBack}
          disabled={isLoading}
        >
          {t('urlInput.back')}
        </button>
      </div>
    </div>
  );
}