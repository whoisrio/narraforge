/**
 * MiMo-V2.5-TTS 面板组件
 *
 * 支持两种模式切换：
 * 1. 预置音色 - 选择内置音色快速合成
 * 2. 音色复刻 - 用已有音频样本复刻音色
 */
import { useState, useEffect, useCallback } from 'react';
import { mimoTtsApi, voiceApi } from '../../services/api';
import { StyleInstructionPicker } from './StyleInstructionPicker';
import type { MiMoPresetVoice, VoiceProfile as CloneVoice } from '../../types';
import styles from './MiMoTTSPanel.module.css';

/** MiMo TTS 子模式 */
export type MiMoMode = 'preset' | 'voiceclone';

interface MiMoTTSPanelProps {
  /** 当前选中的模式 */
  mode: MiMoMode;
  /** 模式切换回调 */
  onModeChange: (mode: MiMoMode) => void;
  /** 预置音色选择回调 */
  onPresetVoiceSelect: (voiceId: string) => void;
  /** 当前选中的预置音色 */
  selectedPresetVoice: string;
  /** 风格指令变更回调 */
  onInstructionChange: (instruction: string) => void;
  /** 当前风格指令 */
  instruction: string;
  /** 克隆声音选择回调 */
  onCloneVoiceSelect: (voiceId: string) => void;
  /** 当前选中的克隆声音ID */
  selectedCloneVoiceId: string;
  /** 排除的克隆引擎类型（默认 ['qwen']，CosyVoice 远端存储 MiMo 无法访问） */
  excludeCloneEngines?: string[];
  /** 项目ID，用于加载项目内的设计声音 */
  projectId?: string;
}

const MODE_TABS: { value: MiMoMode; label: string }[] = [
  { value: 'preset', label: '预置音色' },
  { value: 'voiceclone', label: '音色复刻' },
];

export function MiMoTTSPanel({
  mode,
  onModeChange,
  onPresetVoiceSelect,
  selectedPresetVoice,
  onInstructionChange,
  instruction,
  onCloneVoiceSelect,
  selectedCloneVoiceId,
  excludeCloneEngines = ['qwen'],
  projectId,
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

  // 加载克隆声音列表 (用于 voiceclone 模式，按 clone_engine 过滤)
  const loadCloneVoices = useCallback(async () => {
    setCloneVoicesLoading(true);
    try {
      const all = await voiceApi.list(projectId);
      // 过滤：有音频 且 clone_engine 不在排除列表中
      const availableVoices = all.filter(v => v.audio_url && !excludeCloneEngines.includes(v.voice?.model || ''));
      setCloneVoices(availableVoices);
      if (!selectedCloneVoiceId && availableVoices.length > 0) {
        onCloneVoiceSelect(availableVoices[0].id);
      }
    } catch (err) {
      console.error('Failed to load clone voices:', err);
    } finally {
      setCloneVoicesLoading(false);
    }
  }, [selectedCloneVoiceId, onCloneVoiceSelect, excludeCloneEngines, projectId]);

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
            <StyleInstructionPicker
              value={instruction}
              onChange={onInstructionChange}
              label="风格指令"
              placeholder="选择预设，或直接输入新的风格指令..."
            />
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
              没有可用的声音，请先在「音色设计」页面上传或设计音色
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
            <StyleInstructionPicker
              value={instruction}
              onChange={onInstructionChange}
              label="风格指令"
              placeholder="选择预设，或直接输入新的风格指令..."
            />
          </div>
        </div>
      )}
    </div>
  );
}
