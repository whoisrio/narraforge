/**
 * MiMo-V2.5-TTS 面板组件
 *
 * 支持三种模式切换：
 * 1. 预置音色 - 选择内置音色快速合成
 * 2. 音色设计 - 用文字描述想要的音色
 * 3. 音色复刻 - 用已有音频样本复刻音色
 */
import { useState, useEffect, useCallback } from 'react';
import { mimoTtsApi, voiceApi } from '../../services/api';
import type { MiMoPresetVoice, VoiceProfile as CloneVoice } from '../../types';
import styles from './MiMoTTSPanel.module.css';

/** MiMo TTS 子模式 */
export type MiMoMode = 'preset' | 'voicedesign' | 'voiceclone';

interface MiMoTTSPanelProps {
  /** 当前选中的模式 */
  mode: MiMoMode;
  /** 模式切换回调 */
  onModeChange: (mode: MiMoMode) => void;
  /** 预置音色选择回调 */
  onPresetVoiceSelect: (voiceId: string) => void;
  /** 当前选中的预置音色 */
  selectedPresetVoice: string;
  /** 音色描述文本变更回调 */
  onVoiceDescriptionChange: (desc: string) => void;
  /** 当前音色描述文本 */
  voiceDescription: string;
  /** 合成文本变更回调(for voicedesign, text is optional) */
  onSynthTextChange: (text: string) => void;
  /** 当前合成文本(for voicedesign) */
  synthText: string;
  /** 风格指令变更回调 */
  onInstructionChange: (instruction: string) => void;
  /** 当前风格指令 */
  instruction: string;
  /** 克隆声音选择回调 */
  onCloneVoiceSelect: (voiceId: string) => void;
  /** 当前选中的克隆声音ID */
  selectedCloneVoiceId: string;
  /** 是否自动优化文本(voicedesign) */
  optimizeTextPreview: boolean;
  onOptimizeTextPreviewChange: (v: boolean) => void;
}

const MODE_TABS: { value: MiMoMode; label: string }[] = [
  { value: 'preset', label: '预置音色' },
  { value: 'voicedesign', label: '音色设计' },
  { value: 'voiceclone', label: '音色复刻' },
];

export function MiMoTTSPanel({
  mode,
  onModeChange,
  onPresetVoiceSelect,
  selectedPresetVoice,
  onVoiceDescriptionChange,
  voiceDescription,
  onSynthTextChange,
  synthText,
  onInstructionChange,
  instruction,
  onCloneVoiceSelect,
  selectedCloneVoiceId,
  optimizeTextPreview,
  onOptimizeTextPreviewChange,
}: MiMoTTSPanelProps) {
  const [presetVoices, setPresetVoices] = useState<MiMoPresetVoice[]>([]);
  const [voicesLoading, setVoicesLoading] = useState(false);
  const [voicesError, setVoicesError] = useState('');

  const [cloneVoices, setCloneVoices] = useState<CloneVoice[]>([]);
  const [cloneVoicesLoading, setCloneVoicesLoading] = useState(false);

  // 加载预置音色列表
  useEffect(() => {
    const loadPresetVoices = async () => {
      setVoicesLoading(true);
      setVoicesError('');
      try {
        const voices = await mimoTtsApi.getPresetVoices();
        setPresetVoices(voices);
        // 自动选中第一个非 mimo_default 音色
        if (!selectedPresetVoice && voices.length > 0) {
          const preferred = voices.find(v => v.voice_id !== 'mimo_default');
          onPresetVoiceSelect(preferred?.voice_id || voices[0].voice_id);
        }
      } catch (err) {
        setVoicesError('加载预置音色失败');
        console.error('Failed to load MiMo preset voices:', err);
      } finally {
        setVoicesLoading(false);
      }
    };
    loadPresetVoices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 加载克隆声音列表 (用于 voiceclone 模式，仅显示 MiMo 声音)
  const loadCloneVoices = useCallback(async () => {
    setCloneVoicesLoading(true);
    try {
      const all = await voiceApi.list();
      // 仅显示 MiMo 复刻的声音
      const mimoVoices = all.filter(v => v.is_cloned && v.clone_engine === 'mimo');
      setCloneVoices(mimoVoices);
      if (!selectedCloneVoiceId && mimoVoices.length > 0) {
        onCloneVoiceSelect(mimoVoices[0].id);
      }
    } catch (err) {
      console.error('Failed to load clone voices:', err);
    } finally {
      setCloneVoicesLoading(false);
    }
  }, [selectedCloneVoiceId, onCloneVoiceSelect]);

  useEffect(() => {
    if (mode === 'voiceclone') {
      loadCloneVoices();
    }
  }, [mode, loadCloneVoices]);

  return (
    <div className={styles.container}>
      {/* 模式切换标签 */}
      <div className={styles.modeTabs}>
        {MODE_TABS.map(tab => (
          <button
            key={tab.value}
            className={`${styles.modeTab} ${mode === tab.value ? styles.active : ''}`}
            onClick={() => onModeChange(tab.value)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 预置音色面板 */}
      {mode === 'preset' && (
        <div>
          <div className={styles.sectionTitle}>选择预置音色</div>
          {voicesLoading ? (
            <div className={styles.loading}>加载音色中...</div>
          ) : voicesError ? (
            <div className={styles.error}>{voicesError}</div>
          ) : (
            <div className={styles.voiceGrid}>
              {presetVoices.map(voice => (
                <div
                  key={voice.voice_id}
                  className={`${styles.voiceCard} ${selectedPresetVoice === voice.voice_id ? styles.selected : ''}`}
                  onClick={() => onPresetVoiceSelect(voice.voice_id)}
                >
                  <div className={styles.voiceName}>{voice.name}</div>
                  <div className={styles.voiceMeta}>
                    <span>{voice.language}</span>
                    <span>{voice.gender}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
          {/* 风格指令 */}
          <div className={styles.field} style={{ marginTop: '0.75rem' }}>
            <label>风格指令（可选）</label>
            <textarea
              className={styles.textarea}
              placeholder="输入风格指令，如：用温柔的语调朗读，语速偏慢..."
              value={instruction}
              onChange={(e) => onInstructionChange(e.target.value)}
              rows={2}
            />
          </div>
        </div>
      )}

      {/* 音色设计面板 */}
      {mode === 'voicedesign' && (
        <div>
          <div className={styles.field}>
            <label>音色描述 *</label>
            <textarea
              className={styles.textarea}
              placeholder="描述你想要的音色，例如：&#10;- 年轻的女性声音，温柔甜美，语速中等&#10;- Deep and gravelly middle-aged male, slow and deliberate&#10;- 一位年迈的老先生，说带北方口音的普通话，嗓音略带沙哑和沧桑感"
              value={voiceDescription}
              onChange={(e) => onVoiceDescriptionChange(e.target.value)}
              rows={4}
            />
            <div className={styles.hint}>
              描述越具体越好：性别年龄、音色质感、情绪语气、语速节奏。1-4 句即可，中英文均可。
            </div>
          </div>

          <div className={styles.field}>
            <label>合成文本（可选）</label>
            <textarea
              className={styles.textarea}
              placeholder="留空则自动生成适配文本；填写则使用你指定的文本进行合成"
              value={synthText}
              onChange={(e) => onSynthTextChange(e.target.value)}
              rows={3}
            />
          </div>

          <div className={styles.field}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={optimizeTextPreview}
                onChange={(e) => onOptimizeTextPreviewChange(e.target.checked)}
              />
              智能润色文本
            </label>
            <div className={styles.hint}>
              开启后会自动对目标文本进行润色，使其更贴合音色描述。
            </div>
          </div>
        </div>
      )}

      {/* 音色复刻面板 */}
      {mode === 'voiceclone' && (
        <div>
          <div className={styles.sectionTitle}>选择已有声音</div>
          {cloneVoicesLoading ? (
            <div className={styles.loading}>加载声音列表...</div>
          ) : cloneVoices.length === 0 ? (
            <div className={styles.empty}>
              没有 MiMo 复刻的声音，请先在「声音复刻」页面使用 MiMo 引擎上传音频
            </div>
          ) : (
            <div className={styles.cloneVoiceList}>
              {cloneVoices.map(v => (
                <div
                  key={v.id}
                  className={`${styles.cloneVoiceItem} ${selectedCloneVoiceId === v.id ? styles.selected : ''}`}
                  onClick={() => onCloneVoiceSelect(v.id)}
                >
                  <div>
                    <span className={styles.cloneVoiceName}>{v.name}</span>
                    {v.description && (
                      <div className={styles.cloneVoiceDesc}>{v.description}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
          {/* 风格指令 */}
          <div className={styles.field} style={{ marginTop: '0.75rem' }}>
            <label>风格指令（可选）</label>
            <textarea
              className={styles.textarea}
              placeholder="输入风格指令，如：用欢快的语调朗读..."
              value={instruction}
              onChange={(e) => onInstructionChange(e.target.value)}
              rows={2}
            />
          </div>
        </div>
      )}
    </div>
  );
}
