import { useState } from 'react';
import { voiceApi } from '../../services/api';
import type { VoiceProfile } from '../../types';
import styles from './UrlInput.module.css';

interface UrlInputProps {
  /** URL 确认完成后回调，传递后端创建好的声音记录 */
  onUrlConfirmed: (voice: VoiceProfile) => void;
  /** 用户点击返回 */
  onBack: () => void;
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
export function UrlInput({ onUrlConfirmed, onBack }: UrlInputProps) {
  const [url, setUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleConfirm = async () => {
    const trimmed = url.trim();
    if (!trimmed) {
      setError('请输入音频文件地址');
      return;
    }

    // 前端基础格式校验，真正的可达性由后端 HEAD 请求验证
    try {
      new URL(trimmed);
    } catch {
      setError('请输入有效的 URL 地址');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const result = await voiceApi.uploadFromUrl(trimmed);
      onUrlConfirmed(result);
    } catch (err: unknown) {
      const msg = getErrorDetail(err, '下载失败');
      setError(`确认失败：${msg}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={styles.container}>
      <input
        className={styles.urlInput}
        type="url"
        placeholder="请输入音频文件的公网地址，如 https://example.com/audio.wav"
        value={url}
        onChange={(e) => { setUrl(e.target.value); setError(''); }}
        onKeyDown={(e) => e.key === 'Enter' && handleConfirm()}
        disabled={isLoading}
      />

      {error && <span className={styles.error}>{error}</span>}

      <div className={styles.hint}>
        支持 MP3、WAV、OGG 等音频格式。请确保链接可直接访问（无需登录）。
      </div>

      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <button
          className={styles.confirmButton}
          onClick={handleConfirm}
          disabled={isLoading || !url.trim()}
        >
          {isLoading ? '校验并下载中...' : '确认'}
        </button>
        <button
          className={styles.confirmButton}
          style={{ background: 'var(--color-text-muted)' }}
          onClick={onBack}
          disabled={isLoading}
        >
          返回
        </button>
      </div>
    </div>
  );
}