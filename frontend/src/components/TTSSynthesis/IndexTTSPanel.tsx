/**
 * IndexTTS-2.5 本地 sidecar TTS 面板组件
 *
 * 仅一种模式：zero-shot 参考音频克隆（直接引用语音库已有克隆音色，无需训练/注册）。
 * 情绪不在前端控制——由后端根据段落 emotion 字段映射为 emo_vector；
 * 这里只暴露语言（lang）、情绪强度（emo_alpha）与语速（duration_factor）。
 */
import { useState, useEffect, useCallback } from 'react';
import { indexttsApi, voiceApi } from '../../services/api';
import type { IndexTTSStatus, IndexTTSParams, VoiceProfile as CloneVoice } from '../../types';
import { useTranslation } from '../../i18n';
import styles from './IndexTTSPanel.module.css';

interface IndexTTSPanelProps {
  /** 参考音频 voice_id */
  selectedVoiceId: string;
  onVoiceSelect: (voiceId: string) => void;
  /** 语言 */
  lang: NonNullable<IndexTTSParams['lang']>;
  onLangChange: (lang: NonNullable<IndexTTSParams['lang']>) => void;
  /** 情绪强度（0-1） */
  emoAlpha: number;
  onEmoAlphaChange: (v: number) => void;
  /** 语速（0.5-2.0，>1 变慢，<1 变快） */
  durationFactor: number;
  onDurationFactorChange: (v: number) => void;
  /** 项目ID，用于加载项目内的声音 */
  projectId?: string;
}

function getApiErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null) {
    const response = (error as { response?: { data?: { detail?: unknown } } }).response;
    if (typeof response?.data?.detail === 'string') return response.data.detail;
    const d = response?.data?.detail;
    if (typeof d === 'object' && d !== null && 'message' in d) return (d as { message: string }).message;
  }
  return fallback;
}

export function IndexTTSPanel({
  selectedVoiceId,
  onVoiceSelect,
  lang,
  onLangChange,
  emoAlpha,
  onEmoAlphaChange,
  durationFactor,
  onDurationFactorChange,
  projectId,
}: IndexTTSPanelProps) {
  // ---- 国际化 ----
  const { t } = useTranslation();

  // ---- 模型状态 ----
  const [status, setStatus] = useState<IndexTTSStatus | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState('');

  // ---- 声音列表（zero-shot 可引用任意带参考音频的克隆音色）----
  const [voices, setVoices] = useState<CloneVoice[]>([]);
  const [voicesLoading, setVoicesLoading] = useState(false);

  // 加载模型状态
  const refreshStatus = useCallback(async () => {
    try {
      const s = await indexttsApi.getStatus();
      setStatus(s);
    } catch (err) {
      console.error('Failed to get IndexTTS status:', err);
    }
  }, []);

  useEffect(() => {
    refreshStatus();
    // 每 30 秒刷新一次状态（如果模型已加载）
    const timer = setInterval(() => {
      if (status?.loaded) refreshStatus();
    }, 30000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 加载声音列表
  useEffect(() => {
    const loadVoices = async () => {
      setVoicesLoading(true);
      try {
        const list = await voiceApi.list(projectId);
        setVoices(list.filter(v => v.has_preview || v.has_source));
      } catch (err) {
        console.error('Failed to load voice list:', err);
      } finally {
        setVoicesLoading(false);
      }
    };
    loadVoices();
  }, [projectId]);

  // 加载/卸载模型
  const handleLoad = async () => {
    setActionLoading(true);
    setActionError('');
    try {
      await indexttsApi.loadModel();
      await refreshStatus();
    } catch (err: unknown) {
      setActionError(getApiErrorMessage(err, t('indextts.actions.loadFailed')));
    } finally {
      setActionLoading(false);
    }
  };

  const handleUnload = async () => {
    setActionLoading(true);
    setActionError('');
    try {
      await indexttsApi.unloadModel();
      await refreshStatus();
    } catch (err: unknown) {
      setActionError(getApiErrorMessage(err, t('indextts.actions.unloadFailed')));
    } finally {
      setActionLoading(false);
    }
  };

  const isModelReady = status?.loaded ?? false;
  const isModelLoading = status?.loading || actionLoading;

  return (
    <div className={styles.panel}>
      {/* 模型状态栏 */}
      <div className={styles.statusBar}>
        <div className={styles.statusInfo}>
          <span className={`${styles.statusDot} ${isModelReady ? styles.loaded : styles.unloaded}`} />
          <span className={styles.statusText}>
            {isModelLoading ? t('indextts.status.loading') : isModelReady ? t('indextts.status.ready') : t('indextts.status.notLoaded')}
          </span>
          {isModelReady && status?.load_time_sec ? (
            <span className={styles.loadTime}>{t('indextts.loadTime', { seconds: String(status.load_time_sec) })}</span>
          ) : null}
        </div>
        <div className={styles.statusActions}>
          {isModelReady ? (
            <button className={styles.unloadBtn} onClick={handleUnload} disabled={isModelLoading}>
              {t('indextts.actions.unload')}
            </button>
          ) : (
            <button className={styles.loadBtn} onClick={handleLoad} disabled={isModelLoading}>
              {isModelLoading ? t('common.loading') : t('indextts.actions.load')}
            </button>
          )}
        </div>
      </div>

      {actionError && <div className={styles.error}>{actionError}</div>}

      <div className={styles.modeContent}>
        {/* 参考音频（zero-shot 克隆音色） */}
        <div className={styles.fieldGroup}>
          <label className={styles.label}>{t('indextts.referenceAudio')}</label>
          <select
            className={styles.select}
            value={selectedVoiceId}
            onChange={e => onVoiceSelect(e.target.value)}
          >
            <option value="">{t('indextts.selectVoice')}</option>
            {voices.map(v => (
              <option key={v.id} value={v.id}>
                {v.name || v.description || v.id.slice(0, 8)}
              </option>
            ))}
          </select>
          {voicesLoading && <span className={styles.hint}>{t('common.loading')}</span>}
          <span className={styles.hint}>
            {t('indextts.voicesLoaded', { count: String(voices.length) })}
            {' | '}
            {t('indextts.currentVoice', { name: selectedVoiceId || t('indextts.noVoiceSelected') })}
          </span>
        </div>

        {/* 语言 */}
        <div className={styles.fieldGroup}>
          <label className={styles.label}>{t('indextts.language')}</label>
          <select
            className={styles.select}
            value={lang}
            onChange={e => onLangChange(e.target.value as NonNullable<IndexTTSParams['lang']>)}
          >
            <option value="ZH">中文</option>
            <option value="EN">English</option>
            <option value="JA">日本語</option>
            <option value="ES">Español</option>
            <option value="AR">العربية</option>
          </select>
        </div>

        {/* 语速 */}
        <div className={styles.paramRow}>
          <label className={styles.paramLabel}>{t('indextts.durationFactor')}</label>
          <input
            type="range"
            min="0.5"
            max="2.0"
            step="0.1"
            value={durationFactor}
            onChange={e => onDurationFactorChange(parseFloat(e.target.value))}
            className={styles.slider}
          />
          <span className={styles.paramValue}>{durationFactor.toFixed(1)}×</span>
        </div>

        {/* 情绪强度 */}
        <div className={styles.paramRow}>
          <label className={styles.paramLabel}>{t('indextts.emotionStrength')}</label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.1"
            value={emoAlpha}
            onChange={e => onEmoAlphaChange(parseFloat(e.target.value))}
            className={styles.slider}
          />
          <span className={styles.paramValue}>{emoAlpha.toFixed(1)}</span>
        </div>
      </div>

      {/* 未加载提示 */}
      {!isModelReady && !isModelLoading && (
        <div className={styles.overlayHint}>
          {t('indextts.pleaseLoadModel')}
        </div>
      )}
    </div>
  );
}
