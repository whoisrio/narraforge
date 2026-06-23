import { useMemo, useState } from 'react';
import styles from './StyleInstructionPicker.module.css';

export interface StyleInstructionPreset {
  id: string;
  name: string;
  value: string;
}

interface StyleInstructionPickerProps {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  placeholder?: string;
  dense?: boolean;
}

const STORAGE_KEY = 'narraforge.styleInstructionPresets.v1';
const CUSTOM_VALUE = '__custom__';

const DEFAULT_PRESETS: StyleInstructionPreset[] = [
  { id: 'broadcast', name: '播音主持', value: '吐字清晰，节奏稳健，字正腔圆，有专业播音主持的质感' },
  { id: 'warm', name: '温柔治愈', value: '语速稍慢，语气温柔自然，像贴心朋友一样有安抚感' },
  { id: 'energetic', name: '活力广告', value: '语调更有活力，节奏明快，情绪饱满但不要夸张' },
  { id: 'calm-story', name: '沉稳叙事', value: '语气沉稳克制，节奏舒展，适合纪录片或深度讲述' },
  { id: 'emotional', name: '情绪递进', value: '开头克制，关键句加强重音和停顿，整体有情绪递进' },
];

function makeId() {
  return `style-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function loadPresets(): StyleInstructionPreset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PRESETS;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_PRESETS;
    const cleaned = parsed
      .filter(item => item && typeof item.name === 'string' && typeof item.value === 'string')
      .map(item => ({ id: String(item.id || makeId()), name: item.name.trim(), value: item.value.trim() }))
      .filter(item => item.name && item.value);
    return cleaned.length > 0 ? cleaned : DEFAULT_PRESETS;
  } catch {
    return DEFAULT_PRESETS;
  }
}

function savePresets(presets: StyleInstructionPreset[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
}

export function StyleInstructionPicker({
  value,
  onChange,
  label = '风格指令',
  placeholder = '直接输入风格指令，或从预设中选择...',
  dense = false,
}: StyleInstructionPickerProps) {
  const [presets, setPresetsState] = useState<StyleInstructionPreset[]>(() => loadPresets());
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [selectedPresetId, setSelectedPresetId] = useState(() => {
    const initialPresets = loadPresets();
    return initialPresets.find(preset => preset.value === value)?.id ?? CUSTOM_VALUE;
  });
  const [customValue, setCustomValue] = useState(() => {
    const initialPresets = loadPresets();
    return initialPresets.some(preset => preset.value === value) ? '' : value;
  });

  const selectedPreset = useMemo(
    () => presets.find(preset => preset.id === selectedPresetId),
    [presets, selectedPresetId],
  );

  const setPresets = (updater: (prev: StyleInstructionPreset[]) => StyleInstructionPreset[]) => {
    setPresetsState((prev) => {
      const next = updater(prev);
      savePresets(next);
      return next;
    });
  };

  const selectValue = selectedPreset?.id ?? CUSTOM_VALUE;
  const trimmedValue = value.trim();

  const handleSelect = (presetId: string) => {
    setSelectedPresetId(presetId);
    if (presetId === CUSTOM_VALUE) {
      onChange(customValue);
      return;
    }
    if (selectedPresetId === CUSTOM_VALUE) {
      setCustomValue(value);
    }
    const preset = presets.find(item => item.id === presetId);
    if (preset) onChange(preset.value);
  };

  const handleSaveNew = () => {
    const name = draftName.trim();
    if (!name || !trimmedValue) return;
    const nextPreset = { id: makeId(), name, value: trimmedValue };
    setPresets(prev => [...prev, nextPreset]);
    setSelectedPresetId(nextPreset.id);
    setDraftName('');
    setEditing(false);
  };

  const handleUpdate = () => {
    if (!selectedPreset || !trimmedValue) return;
    setPresets(prev => prev.map(item => (
      item.id === selectedPreset.id ? { ...item, value: trimmedValue } : item
    )));
  };

  const handleRename = () => {
    if (!selectedPreset) return;
    const name = draftName.trim();
    if (!name) return;
    setPresets(prev => prev.map(item => (
      item.id === selectedPreset.id ? { ...item, name } : item
    )));
    setDraftName('');
  };

  const handleDelete = () => {
    if (!selectedPreset) return;
    setPresets(prev => prev.filter(item => item.id !== selectedPreset.id));
    setSelectedPresetId(CUSTOM_VALUE);
  };

  return (
    <div className={`${styles.picker} ${dense ? styles.dense : ''}`}>
      <div className={styles.topRow}>
        <label className={styles.label}>{label}</label>
        <select
          className={styles.select}
          value={selectValue}
          onChange={event => handleSelect(event.target.value)}
        >
          <option value={CUSTOM_VALUE}>自定义输入</option>
          {presets.map(preset => (
            <option key={preset.id} value={preset.id}>{preset.name}</option>
          ))}
        </select>
        <button
          type="button"
          className={styles.manageBtn}
          onClick={() => {
            setEditing(prev => !prev);
            setDraftName(selectedPreset?.name || '');
          }}
        >
          预设
        </button>
      </div>

      <textarea
        className={styles.textarea}
        value={value}
        onChange={event => {
          if (selectedPresetId !== CUSTOM_VALUE) {
            setSelectedPresetId(CUSTOM_VALUE);
          }
          setCustomValue(event.target.value);
          onChange(event.target.value);
        }}
        rows={dense ? 1 : 2}
        placeholder={placeholder}
      />

      {editing && (
        <div className={styles.manager}>
          <input
            className={styles.nameInput}
            value={draftName}
            onChange={event => setDraftName(event.target.value)}
            placeholder={selectedPreset ? '预设名称' : '新预设名称'}
          />
          <button type="button" className={styles.actionBtn} disabled={!trimmedValue || !draftName.trim()} onClick={handleSaveNew}>新增</button>
          <button type="button" className={styles.actionBtn} disabled={!selectedPreset || !trimmedValue} onClick={handleUpdate}>更新内容</button>
          <button type="button" className={styles.actionBtn} disabled={!selectedPreset || !draftName.trim()} onClick={handleRename}>改名</button>
          <button type="button" className={styles.deleteBtn} disabled={!selectedPreset} onClick={handleDelete}>删除</button>
        </div>
      )}
    </div>
  );
}
