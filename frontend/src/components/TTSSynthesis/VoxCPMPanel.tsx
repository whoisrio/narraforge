/**
 * VoxCPM 本地 GPU TTS 面板组件
 *
 * 支持两种模式：
 * 1. Clone — 参考音频克隆 + 可选风格控制
 * 2. Ultimate Clone — 参考音频 + 转录文本最高保真克隆
 *
 * 注：TTS（纯文本合成）和 Voice Design（音色设计）不在工作室提供。
 * 音色设计仅在角色语音设计（VoiceRoleEditor）中可用。
 */
import { useState, useEffect, useCallback } from 'react';
import { voxcpmApi, voiceApi } from '../../services/api';
import { StyleInstructionPicker } from './StyleInstructionPicker';
import type { VoxCPMStatus, VoiceProfile as CloneVoice } from '../../types';
import { useTranslation } from '../../i18n';
import styles from './VoxCPMPanel.module.css';

/** VoxCPM 子模式（工作室只保留 clone 和 ultimate） */
export type VoxCPMMode = 'clone' | 'ultimate';

interface VoxCPMPanelProps {
  mode: VoxCPMMode;
  onModeChange: (mode: VoxCPMMode) => void;
  /** Clone 风格控制 */
  styleControl: string;
  onStyleControlChange: (style: string) => void;
  /** Ultimate 转录文本 */
  promptText: string;
  onPromptTextChange: (text: string) => void;
  /** 参考音频 voice_id */
  selectedVoiceId: string;
  onVoiceSelect: (voiceId: string) => void;
  /** 高级参数 */
  cfgValue: number;
  onCfgValueChange: (v: number) => void;
  inferenceTimesteps: number;
  onInferenceTimestepsChange: (v: number) => void;
  /** 允许的克隆引擎类型（默认 ['voxcpm']） */
  allowedCloneEngines?: string[];
  /** 项目ID，用于加载项目内的设计声音 */
  projectId?: string;
}

const MODE_TABS: { value: VoxCPMMode; labelKey: string; icon: string }[] = [
  { value: 'clone', labelKey: 'voxcpm.modes.clone', icon: '🎛️' },
  { value: 'ultimate', labelKey: 'voxcpm.modes.ultimate', icon: '🎙️' },
];

function getApiErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null) {
    const response = (error as { response?: { data?: { detail?: unknown } } }).response;
    if (typeof response?.data?.detail === 'string') return response.data.detail;
  }
  return fallback;
}

export function VoxCPMPanel({
  mode,
  onModeChange,
  styleControl,
  onStyleControlChange,
  promptText,
  onPromptTextChange,
  selectedVoiceId,
  onVoiceSelect,
  cfgValue,
  onCfgValueChange,
  inferenceTimesteps,
  onInferenceTimestepsChange,
  allowedCloneEngines = ['voxcpm'],
  projectId,
}: VoxCPMPanelProps) {
  // ---- 国际化 ----
  const { t } = useTranslation();

  // ---- 模型状态 ----
  const [status, setStatus] = useState<VoxCPMStatus | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState('');

  // ---- 声音列表（clone/ultimate 模式用）----
  const [voices, setVoices] = useState<CloneVoice[]>([]);
  const [voicesLoading, setVoicesLoading] = useState(false);

  // ---- 高级参数面板 ----
  const [showAdvanced, setShowAdvanced] = useState(false);

  // 加载模型状态
  const refreshStatus = useCallback(async () => {
    try {
      const s = await voxcpmApi.getStatus();
      setStatus(s);
    } catch (err) {
      console.error('Failed to get VoxCPM status:', err);
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

  // 加载声音列表（clone/ultimate 模式共用，按 allowedCloneEngines 过滤）
  useEffect(() => {
    const loadVoices = async () => {
      setVoicesLoading(true);
      try {
        const list = await voiceApi.list(projectId);
        // 按 allowedCloneEngines 过滤
        setVoices(list.filter(v => v.audio_url && allowedCloneEngines.includes(v.voice?.model || '')));
      } catch (err) {
        console.error('Failed to load voice list:', err);
      } finally {
        setVoicesLoading(false);
      }
    };
    loadVoices();
  }, [mode, allowedCloneEngines, projectId]);

  // 选中声音变化时，自动加载其 prompt_text（ultimate 模式）
  // design 声音用 audition_text（试听音频转录），clone 声音用 prompt_text（录音转录）
  useEffect(() => {
    if (mode !== 'ultimate' || !selectedVoiceId) return;
    const voice = voices.find(v => v.id === selectedVoiceId);
    if (!voice) return;
    const auditionText = typeof voice.preview?.audition_text === 'string' ? voice.preview.audition_text : '';
    const params = (voice.voice_params?.[voice.voice?.model || '']?.params || {}) as Record<string, unknown>;
    const promptText = typeof params?.prompt_text === 'string' ? params.prompt_text : '';
    const prompt = auditionText || promptText || '';
    if (prompt) {
      onPromptTextChange(prompt);
    }
  }, [selectedVoiceId, voices, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  // 加载/卸载模型
  const handleLoad = async () => {
    setActionLoading(true);
    setActionError('');
    try {
      await voxcpmApi.loadModel();
      await refreshStatus();
    } catch (err: unknown) {
      setActionError(getApiErrorMessage(err, t('voxcpm.actions.loadFailed')));
    } finally {
      setActionLoading(false);
    }
  };

  const handleUnload = async () => {
    setActionLoading(true);
    setActionError('');
    try {
      await voxcpmApi.unloadModel();
      await refreshStatus();
    } catch (err: unknown) {
      setActionError(getApiErrorMessage(err, t('voxcpm.actions.unloadFailed')));
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
            {isModelLoading ? t('voxcpm.status.loading') : isModelReady ? t('voxcpm.status.ready') : t('voxcpm.status.notLoaded')}
          </span>
          {isModelReady && status && (
            <span className={styles.vramBadge}>
              {t('voxcpm.vram', { used: String(status.vram_used_mb), total: String(status.gpu_total_mb) })}
            </span>
          )}
          {isModelReady && status?.load_time_sec ? (
            <span className={styles.loadTime}>{t('voxcpm.loadTime', { seconds: String(status.load_time_sec) })}</span>
          ) : null}
        </div>
        <div className={styles.statusActions}>
          {isModelReady ? (
            <button className={styles.unloadBtn} onClick={handleUnload} disabled={isModelLoading}>
              {t('voxcpm.actions.unload')}
            </button>
          ) : (
            <button className={styles.loadBtn} onClick={handleLoad} disabled={isModelLoading}>
              {isModelLoading ? t('voxcpm.actions.loading') : t('voxcpm.actions.load')}
            </button>
          )}
        </div>
      </div>

      {actionError && <div className={styles.error}>{actionError}</div>}

      {/* 模式切换 */}
      <div className={styles.modeTabs}>
        {MODE_TABS.map(tab => (
          <button
            key={tab.value}
            className={`${styles.modeTab} ${mode === tab.value ? styles.active : ''}`}
            onClick={() => onModeChange(tab.value)}
          >
            <span className={styles.modeIcon}>{tab.icon}</span>
            <span>{t(tab.labelKey)}</span>
          </button>
        ))}
      </div>

      {/* 模式内容 */}
      <div className={styles.modeContent}>
        {/* Clone 模式 */}
        {mode === 'clone' && (
          <>
            <div className={styles.fieldGroup}>
              <label className={styles.label}>{t('voxcpm.referenceAudio')}</label>
              <select
                className={styles.select}
                value={selectedVoiceId}
                onChange={e => {
                  console.log('[VoxCPMPanel] voice selected:', e.target.value);
                  onVoiceSelect(e.target.value);
                }}
              >
                <option value="">{t('voxcpm.selectVoice')}</option>
                {voices.map(v => (
                  <option key={v.id} value={v.id}>
                    {v.name || v.description || v.id.slice(0, 8)}
                  </option>
                ))}
              </select>
              {voicesLoading && <span className={styles.hint}>{t('voxcpm.loadingVoices')}</span>}
              <span className={styles.hint}>
                {t('voxcpm.voicesLoaded', { count: String(voices.length) })}
                {' | '}
                {t('voxcpm.currentVoice', { name: selectedVoiceId || t('voxcpm.noVoiceSelected') })}
              </span>
            </div>
            <div className={styles.fieldGroup}>
              <StyleInstructionPicker
                value={styleControl}
                onChange={onStyleControlChange}
                label={t('voxcpm.styleInstruction')}
                placeholder={t('voxcpm.styleInstructionPlaceholder')}
                dense
              />
            </div>
          </>
        )}

        {/* Ultimate Clone 模式 */}
        {mode === 'ultimate' && (
          <>
            <div className={styles.fieldGroup}>
              <label className={styles.label}>{t('voxcpm.referenceAudio')}</label>
              <select
                className={styles.select}
                value={selectedVoiceId}
                onChange={e => {
                  console.log('[VoxCPMPanel] voice selected:', e.target.value);
                  onVoiceSelect(e.target.value);
                }}
              >
                <option value="">{t('voxcpm.selectVoice')}</option>
                {voices.map(v => (
                  <option key={v.id} value={v.id}>
                    {v.name || v.description || v.id.slice(0, 8)}
                  </option>
                ))}
              </select>
              {voicesLoading && <span className={styles.hint}>{t('voxcpm.loadingVoices')}</span>}
              {promptText && (
                <div className={styles.promptReadOnly}>
                  <span className={styles.promptReadOnlyLabel}>{t('voxcpm.promptText')}</span>
                  <span className={styles.promptReadOnlyText}>{promptText}</span>
                </div>
              )}
              {selectedVoiceId && !promptText && (
                <span className={styles.hint} style={{ color: 'var(--color-danger, #ef4444)' }}>
                  {t('voxcpm.warningNoPromptText')}
                </span>
              )}
              <span className={styles.hint}>{t('voxcpm.voicesLoaded', { count: String(voices.length) })}</span>
            </div>
            <div className={styles.fieldGroup}>
              <StyleInstructionPicker
                value={styleControl}
                onChange={onStyleControlChange}
                label={t('voxcpm.styleInstruction')}
                placeholder={t('voxcpm.styleInstructionPlaceholder')}
                dense
              />
            </div>
          </>
        )}

        {/* 高级参数（折叠） */}
        <div className={styles.advancedToggle} onClick={() => setShowAdvanced(!showAdvanced)}>
          <span>{showAdvanced ? '▼' : '▶'} {t('voxcpm.advancedParams')}</span>
        </div>
        {showAdvanced && (
          <div className={styles.advancedPanel}>
            <div className={styles.paramRow}>
              <label className={styles.paramLabel}>{t('voxcpm.cfgStrength')}</label>
              <input
                type="range"
                min="1"
                max="5"
                step="0.1"
                value={cfgValue}
                onChange={e => onCfgValueChange(parseFloat(e.target.value))}
                className={styles.slider}
              />
              <span className={styles.paramValue}>{cfgValue.toFixed(1)}</span>
            </div>
            <div className={styles.paramRow}>
              <label className={styles.paramLabel}>{t('voxcpm.denoisingSteps')}</label>
              <input
                type="range"
                min="1"
                max="50"
                step="1"
                value={inferenceTimesteps}
                onChange={e => onInferenceTimestepsChange(parseInt(e.target.value))}
                className={styles.slider}
              />
              <span className={styles.paramValue}>{inferenceTimesteps}</span>
            </div>
          </div>
        )}
      </div>

      {/* 未加载提示 */}
      {!isModelReady && !isModelLoading && (
        <div className={styles.overlayHint}>
          {t('voxcpm.pleaseLoadModel')}
        </div>
      )}
    </div>
  );
}
