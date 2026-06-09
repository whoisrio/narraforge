/**
 * VoxCPM 本地 GPU TTS 面板组件
 *
 * 支持四种模式：
 * 1. TTS — 纯文本合成
 * 2. Voice Design — 文本描述生成全新音色
 * 3. Clone — 参考音频克隆 + 可选风格控制
 * 4. Ultimate Clone — 参考音频 + 转录文本最高保真克隆
 */
import { useState, useEffect, useCallback } from 'react';
import { voxcpmApi, voiceApi } from '../../services/api';
import type { VoxCPMStatus, VoiceProfile as CloneVoice } from '../../types';
import styles from './VoxCPMPanel.module.css';

/** VoxCPM 子模式 */
export type VoxCPMMode = 'tts' | 'design' | 'clone' | 'ultimate';

interface VoxCPMPanelProps {
  mode: VoxCPMMode;
  onModeChange: (mode: VoxCPMMode) => void;
  /** Voice Design 音色描述 */
  voiceDescription: string;
  onVoiceDescriptionChange: (desc: string) => void;
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
}

const MODE_TABS: { value: VoxCPMMode; label: string; icon: string }[] = [
  { value: 'tts', label: '文本合成', icon: '🗣️' },
  { value: 'design', label: 'Voice Design', icon: '🎨' },
  { value: 'clone', label: '声音克隆', icon: '🎛️' },
  { value: 'ultimate', label: '极致克隆', icon: '🎙️' },
];

export function VoxCPMPanel({
  mode,
  onModeChange,
  voiceDescription,
  onVoiceDescriptionChange,
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
}: VoxCPMPanelProps) {
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
      console.error('获取 VoxCPM 状态失败:', err);
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

  // 加载声音列表（clone/ultimate 模式）
  useEffect(() => {
    if (mode !== 'clone' && mode !== 'ultimate') return;
    const loadVoices = async () => {
      setVoicesLoading(true);
      try {
        const list = await voiceApi.list();
        console.log('[VoxCPMPanel] loaded voices:', list.length, list.map(v => ({ id: v.id.slice(0,8), name: v.name, clone_engine: v.clone_engine, hasAudio: !!v.audio_url })));
        // 显示所有已上传的声音（不限 clone_engine，因为 VoxCPM 可以用任何音频作为参考）
        setVoices(list.filter(v => v.audio_url));
      } catch (err) {
        console.error('加载声音列表失败:', err);
      } finally {
        setVoicesLoading(false);
      }
    };
    loadVoices();
  }, [mode]);

  // 加载/卸载模型
  const handleLoad = async () => {
    setActionLoading(true);
    setActionError('');
    try {
      await voxcpmApi.loadModel();
      await refreshStatus();
    } catch (err: any) {
      setActionError(err?.response?.data?.detail || '加载失败');
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
    } catch (err: any) {
      setActionError(err?.response?.data?.detail || '释放失败');
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
            {isModelLoading ? '模型加载中...' : isModelReady ? '模型已就绪' : '模型未加载'}
          </span>
          {isModelReady && status && (
            <span className={styles.vramBadge}>
              GPU: {status.vram_used_mb}MB / {status.gpu_total_mb}MB
            </span>
          )}
          {isModelReady && status?.load_time_sec ? (
            <span className={styles.loadTime}>加载耗时 {status.load_time_sec}s</span>
          ) : null}
        </div>
        <div className={styles.statusActions}>
          {isModelReady ? (
            <button className={styles.unloadBtn} onClick={handleUnload} disabled={isModelLoading}>
              释放显存
            </button>
          ) : (
            <button className={styles.loadBtn} onClick={handleLoad} disabled={isModelLoading}>
              {isModelLoading ? '加载中...' : '加载模型'}
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
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* 模式内容 */}
      <div className={styles.modeContent}>
        {/* TTS 模式 — 无额外字段，使用页面主文本框 */}
        {mode === 'tts' && (
          <div className={styles.hint} style={{ padding: '8px 0', color: 'var(--text-secondary, #6b7280)' }}>
            在下方文本框输入要合成的文字
          </div>
        )}

        {/* Voice Design 模式 */}
        {mode === 'design' && (
          <div className={styles.fieldGroup}>
            <label className={styles.label}>音色描述</label>
            <textarea
              className={styles.textarea}
              value={voiceDescription}
              onChange={e => onVoiceDescriptionChange(e.target.value)}
              placeholder="描述你想要的音色，如：年轻女性，温柔甜美，语速适中..."
              rows={3}
            />
          </div>
        )}

        {/* Clone 模式 */}
        {mode === 'clone' && (
          <>
            <div className={styles.fieldGroup}>
              <label className={styles.label}>参考音频</label>
              <select
                className={styles.select}
                value={selectedVoiceId}
                onChange={e => {
                  console.log('[VoxCPMPanel] voice selected:', e.target.value);
                  onVoiceSelect(e.target.value);
                }}
              >
                <option value="">-- 选择已上传的声音 --</option>
                {voices.map(v => (
                  <option key={v.id} value={v.id}>
                    {v.name || v.description || v.id.slice(0, 8)}
                  </option>
                ))}
              </select>
              {voicesLoading && <span className={styles.hint}>加载中...</span>}
              <span className={styles.hint}>已加载 {voices.length} 个声音 | 当前: {selectedVoiceId || '未选择'}</span>
            </div>
            <div className={styles.fieldGroup}>
              <label className={styles.label}>
                风格控制 <span className={styles.optional}>（可选）</span>
              </label>
              <input
                className={styles.input}
                value={styleControl}
                onChange={e => onStyleControlChange(e.target.value)}
                placeholder="如：语速稍快，欢快的语气..."
              />
            </div>
          </>
        )}

        {/* Ultimate Clone 模式 */}
        {mode === 'ultimate' && (
          <>
            <div className={styles.fieldGroup}>
              <label className={styles.label}>参考音频</label>
              <select
                className={styles.select}
                value={selectedVoiceId}
                onChange={e => {
                  console.log('[VoxCPMPanel] voice selected:', e.target.value);
                  onVoiceSelect(e.target.value);
                }}
              >
                <option value="">-- 选择已上传的声音 --</option>
                {voices.map(v => (
                  <option key={v.id} value={v.id}>
                    {v.name || v.description || v.id.slice(0, 8)}
                  </option>
                ))}
              </select>
              {voicesLoading && <span className={styles.hint}>加载中...</span>}
              <span className={styles.hint}>已加载 {voices.length} 个声音 | 当前: {selectedVoiceId || '未选择'}</span>
            </div>
            <div className={styles.fieldGroup}>
              <label className={styles.label}>参考音频转录</label>
              <textarea
                className={styles.textarea}
                value={promptText}
                onChange={e => onPromptTextChange(e.target.value)}
                placeholder="输入参考音频的完整文字转录..."
                rows={3}
              />
            </div>
          </>
        )}

        {/* 高级参数（折叠） */}
        <div className={styles.advancedToggle} onClick={() => setShowAdvanced(!showAdvanced)}>
          <span>{showAdvanced ? '▼' : '▶'} 高级参数</span>
        </div>
        {showAdvanced && (
          <div className={styles.advancedPanel}>
            <div className={styles.paramRow}>
              <label className={styles.paramLabel}>CFG 强度</label>
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
              <label className={styles.paramLabel}>去噪步数</label>
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
          请先加载模型后再进行合成
        </div>
      )}
    </div>
  );
}
