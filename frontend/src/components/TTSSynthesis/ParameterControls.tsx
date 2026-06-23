import { useState, useEffect, useCallback } from 'react';
import type { TTSRequest } from '../../types';
import styles from './ParameterControls.module.css';

interface ParameterControlsProps {
  params: Partial<TTSRequest>;
  onParamChange: (params: Partial<TTSRequest>) => void;
}

const LANGUAGE_OPTIONS = [
  { value: 'Chinese', label: '中文' },
  { value: 'English', label: 'English' },
  { value: 'Japanese', label: '日本語' },
  { value: 'Korean', label: '한국어' },
] as const;

/** 预设复刻指令列表 */
const INSTRUCTION_PRESETS = [
  { label: '广告配音', value: '音调偏高，语速中等，充满活力和感染力，适合广告配音' },
  { label: '播音主持', value: '吐字清晰精准，字正腔圆' },
  { label: '温柔治愈', value: '语速偏慢，音调温柔甜美，语气治愈温暖，像贴心朋友般关怀' },
] as const;

const DEFAULT_INSTRUCTION = INSTRUCTION_PRESETS[0].value;

// localStorage 键名，用于记住用户上次的复刻指令和开关选择
const STORAGE_KEY = 'cosyvoice_params';

/** 从 localStorage 读取持久化的参数 */
function loadPersistedParams(): {
  instruction: string;
  enable_ssml: boolean;
  enable_markdown_filter: boolean;
} {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        instruction: parsed.instruction || DEFAULT_INSTRUCTION,
        enable_ssml: parsed.enable_ssml ?? false,
        enable_markdown_filter: parsed.enable_markdown_filter ?? false,
      };
    }
  } catch { /* 忽略解析错误，返回默认值 */ }
  return { instruction: DEFAULT_INSTRUCTION, enable_ssml: false, enable_markdown_filter: false };
}

/** 将参数持久化到 localStorage */
function persistParams(
  instruction: string,
  enable_ssml: boolean,
  enable_markdown_filter: boolean,
) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      instruction,
      enable_ssml,
      enable_markdown_filter,
    }));
  } catch { /* 忽略存储错误 */ }
}

export function ParameterControls({ params, onParamChange }: ParameterControlsProps) {
  const [collapsed, setCollapsed] = useState(true);

  // 初始化时从 localStorage 恢复用户上次的选择
  useEffect(() => {
    const persisted = loadPersistedParams();
    // 仅当 params 中没有这些值时才恢复（避免覆盖父组件传入的值）
    if (params.instruction === undefined && params.enable_ssml === undefined && params.enable_markdown_filter === undefined) {
      onParamChange({
        ...params,
        instruction: persisted.instruction,
        enable_ssml: persisted.enable_ssml,
        enable_markdown_filter: persisted.enable_markdown_filter,
      });
    }
  }, []); // 仅在挂载时执行一次

  // 每次值变更时持久化
  const handleInstructionChange = useCallback((instruction: string) => {
    const clamped = instruction.slice(0, 50);
    persistParams(clamped, params.enable_ssml ?? false, params.enable_markdown_filter ?? false);
    onParamChange({ ...params, instruction: clamped });
  }, [params, onParamChange]);

  const handleSsmlToggle = useCallback(() => {
    const next = !(params.enable_ssml ?? false);
    persistParams(params.instruction ?? DEFAULT_INSTRUCTION, next, params.enable_markdown_filter ?? false);
    onParamChange({ ...params, enable_ssml: next });
  }, [params, onParamChange]);

  const handleMarkdownFilterToggle = useCallback(() => {
    const next = !(params.enable_markdown_filter ?? false);
    persistParams(params.instruction ?? DEFAULT_INSTRUCTION, params.enable_ssml ?? false, next);
    onParamChange({ ...params, enable_markdown_filter: next });
  }, [params, onParamChange]);

  const currentInstruction = params.instruction ?? DEFAULT_INSTRUCTION;
  const currentSsml = params.enable_ssml ?? false;
  const currentMarkdownFilter = params.enable_markdown_filter ?? false;

  // 判断当前指令是否匹配某个预设
  const activePreset = INSTRUCTION_PRESETS.find(p => p.value === currentInstruction);

  return (
    <div className={styles.container}>
      <button
        type="button"
        className={styles.header}
        onClick={() => setCollapsed(!collapsed)}
        aria-expanded={!collapsed}
      >
        <span>参数设置</span>
        <span className={styles.arrow}>{collapsed ? '展开' : '收起'}</span>
      </button>

      {!collapsed && (
        <div className={styles.controls}>
          {/* Language */}
          <div className={styles.control}>
            <label htmlFor="language">语言</label>
            <select
              id="language"
              value={params.language || 'Chinese'}
              onChange={(e) => onParamChange({ ...params, language: e.target.value as TTSRequest['language'] })}
            >
              {LANGUAGE_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          {/* Speed */}
          <div className={styles.control}>
            <label htmlFor="speed">语速: {(params.speed ?? 1.0).toFixed(1)}x</label>
            <input
              id="speed"
              type="range"
              min="0.5"
              max="2.0"
              step="0.1"
              role="slider"
              aria-label="语速"
              value={params.speed ?? 1.0}
              onChange={(e) => onParamChange({ ...params, speed: parseFloat(e.target.value) })}
            />
          </div>

          {/* Volume */}
          <div className={styles.control}>
            <label htmlFor="volume">音量: {params.volume ?? 80}</label>
            <input
              id="volume"
              type="range"
              min="0"
              max="100"
              step="1"
              role="slider"
              aria-label="音量"
              value={params.volume ?? 80}
              onChange={(e) => onParamChange({ ...params, volume: parseInt(e.target.value) })}
            />
          </div>

          {/* Pitch */}
          <div className={styles.control}>
            <label htmlFor="pitch">语调: {(params.pitch ?? 1.0).toFixed(1)}</label>
            <input
              id="pitch"
              type="range"
              min="0.5"
              max="2.0"
              step="0.1"
              role="slider"
              aria-label="语调"
              value={params.pitch ?? 1.0}
              onChange={(e) => onParamChange({ ...params, pitch: parseFloat(e.target.value) })}
            />
          </div>

          {/* 复刻指令 */}
          <div className={styles.instructionSection}>
            <label htmlFor="instruction">复刻指令</label>
            <input
              id="instruction"
              type="text"
              className={styles.instructionInput}
              value={currentInstruction}
              maxLength={50}
              onChange={(e) => handleInstructionChange(e.target.value)}
              placeholder="输入复刻指令..."
            />
            <span className={styles.charCount}>{currentInstruction.length}/50</span>

            {/* 预设快速选择 */}
            <div className={styles.presetButtons}>
              {INSTRUCTION_PRESETS.map(preset => (
                <button
                  key={preset.label}
                  type="button"
                  className={`${styles.presetButton} ${activePreset?.label === preset.label ? styles.presetActive : ''}`}
                  onClick={() => handleInstructionChange(preset.value)}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          {/* 开关选项 */}
          <div className={styles.toggles}>
            <div className={styles.toggle}>
              <span>启用 SSML</span>
              <button
                type="button"
                className={`${styles.toggleButton} ${currentSsml ? styles.toggleOn : ''}`}
                onClick={handleSsmlToggle}
                role="switch"
                aria-checked={currentSsml}
              >
                {currentSsml ? '开' : '关'}
              </button>
            </div>
            <div className={styles.toggle}>
              <span>过滤 Markdown 标记</span>
              <button
                type="button"
                className={`${styles.toggleButton} ${currentMarkdownFilter ? styles.toggleOn : ''}`}
                onClick={handleMarkdownFilterToggle}
                role="switch"
                aria-checked={currentMarkdownFilter}
              >
                {currentMarkdownFilter ? '开' : '关'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}