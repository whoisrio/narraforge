# Frontend UI Improvements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Improve TTSSynthesis page usability — replace VoiceSelector button list with dropdown, make ParameterControls collapsible (default collapsed), and add "Clear All" button to VoiceList.

**Architecture:** Pure frontend changes only. VoiceSelector props simplified (remove `onDelete`), ParameterControls gains internal collapsed/expanded state, VoiceList adds batch delete. No backend or API changes.

**Tech Stack:** React + TypeScript, CSS Modules

---

### Task 1: VoiceSelector — Button List → Dropdown

**Files:**
- Modify: `frontend/src/components/TTSSynthesis/VoiceSelector.tsx`
- Modify: `frontend/src/components/TTSSynthesis/VoiceSelector.module.css`
- Modify: `frontend/src/pages/TTSSynthesis.tsx`

**Step 1: Rewrite VoiceSelector.tsx with dropdown**

Replace current chip-button list with a `<select>` dropdown. Remove `onDelete` prop — deletion is handled on the VoiceClone page only.

```tsx
import { useState, useEffect } from 'react';
import { ttsApi } from '../../services/api';
import type { VoiceProfile } from '../../types';
import styles from './VoiceSelector.module.css';

interface VoiceSelectorProps {
  selectedVoiceId: string;
  onVoiceSelect: (voiceId: string) => void;
}

export function VoiceSelector({ selectedVoiceId, onVoiceSelect }: VoiceSelectorProps) {
  const [voices, setVoices] = useState<VoiceProfile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const loadVoices = async () => {
      try {
        const data = await ttsApi.getVoices();
        setVoices(data);
        // 未选择声音时，自动选中第一个
        if (data.length > 0 && !selectedVoiceId) {
          onVoiceSelect(data[0].qwen_voice_id || data[0].id);
        }
      } catch (err) {
        setError('加载声音列表失败');
        console.error('Failed to load voices:', err);
      } finally {
        setIsLoading(false);
      }
    };
    loadVoices();
  }, []);

  if (isLoading) {
    return <div className={styles.loading}>加载声音列表...</div>;
  }

  if (error) {
    return <div className={styles.error}>{error}</div>;
  }

  if (voices.length === 0) {
    return <div className={styles.empty}>暂无克隆声音，请先在"声音克隆"页面上传音频</div>;
  }

  return (
    <div className={styles.container}>
      <label htmlFor="voice-select" className={styles.label}>选择声音</label>
      <select
        id="voice-select"
        className={styles.select}
        value={selectedVoiceId || ''}
        onChange={(e) => onVoiceSelect(e.target.value)}
        data-testid="voice-select"
      >
        {!selectedVoiceId && (
          <option value="" disabled>请选择声音...</option>
        )}
        {voices.map(voice => {
          const voiceKey = voice.qwen_voice_id || voice.id;
          return (
            <option key={voice.id} value={voiceKey}>
              {voice.name} · 克隆
            </option>
          );
        })}
      </select>
    </div>
  );
}
```

**Step 2: Simplify VoiceSelector.module.css**

Remove chip/button styles, keep only dropdown-related styles.

```css
.container {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.label {
  font-weight: 600;
  font-size: 14px;
}

.select {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid #e0e0e0;
  border-radius: 6px;
  font-size: 14px;
  background: #fff;
  cursor: pointer;
}

.loading,
.error,
.empty {
  font-size: 13px;
  color: #999;
  padding: 4px 0;
}
```

**Step 3: Update TTSSynthesis.tsx — remove `onDelete` from VoiceSelector**

Remove the `handleDeleteVoice` callback and the `onDelete` prop passed to VoiceSelector.

In `TTSSynthesis.tsx`:
- Remove the `voiceApi` import (line 6: `import { ttsApi, voiceApi } from '../services/api';` — keep `voiceApi` only if EdgeTTSPanel needs it, otherwise remove)
- Remove `handleDeleteVoice` callback (lines 127-134)
- Remove `onDelete={handleDeleteVoice}` prop from VoiceSelector (line 189)

**Step 4: Verify build succeeds**

Run: `cd frontend && npm run build`
Expected: No TypeScript errors, build succeeds.

**Step 5: Manually test**

- Start dev server: `cd frontend && npm run dev`
- Open TTSSynthesis page with CosyVoice engine selected
- Verify voice dropdown appears, selecting a voice works
- Verify Edge-TTS panel still works (no changes there)

---

### Task 2: ParameterControls — Collapsible Panel

**Files:**
- Modify: `frontend/src/components/TTSSynthesis/ParameterControls.tsx`
- Modify: `frontend/src/components/TTSSynthesis/ParameterControls.module.css`

**Step 1: Add collapse toggle state to ParameterControls.tsx**

Add `useState` for `collapsed` (default `true`). Wrap current controls in a conditional block.

```tsx
import { useState } from 'react';
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

const EMOTION_OPTIONS = [
  { value: '', label: '默认' },
  { value: 'neutral', label: '平静' },
  { value: 'happy', label: '开心' },
  { value: 'sad', label: '悲伤' },
  { value: 'nervous', label: '紧张' },
  { value: 'excited', label: '激动' },
] as const;

export function ParameterControls({ params, onParamChange }: ParameterControlsProps) {
  const [collapsed, setCollapsed] = useState(true);

  return (
    <div className={styles.container}>
      {/* 头部栏：始终显示，点击切换折叠状态 */}
      <button
        type="button"
        className={styles.header}
        onClick={() => setCollapsed(!collapsed)}
        aria-expanded={!collapsed}
      >
        <span>参数设置</span>
        <span className={styles.arrow}>{collapsed ? '展开' : '收起'}</span>
      </button>

      {/* 控件面板：折叠时隐藏 */}
      {!collapsed && (
        <div className={styles.controls}>
          {/* Language */}
          <div className={styles.control}>
            <label htmlFor="language">语言</label>
            <select
              id="language"
              value={params.language || 'Chinese'}
              onChange={(e) => onParamChange({ ...params, language: e.target.value as any })}
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
            <label htmlFor="pitch">语调: {params.pitch ?? 0}</label>
            <input
              id="pitch"
              type="range"
              min="-12"
              max="12"
              step="1"
              role="slider"
              aria-label="语调"
              value={params.pitch ?? 0}
              onChange={(e) => onParamChange({ ...params, pitch: parseInt(e.target.value) })}
            />
          </div>

          {/* Emotion */}
          <div className={styles.control}>
            <label htmlFor="emotion">语气</label>
            <select
              id="emotion"
              value={params.emotion || ''}
              onChange={(e) => {
                const value = e.target.value || undefined;
                onParamChange({ ...params, emotion: value as any });
              }}
            >
              {EMOTION_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        </div>
      )}
    </div>
  );
}
```

**Step 2: Update ParameterControls.module.css for collapsible panel**

Replace existing styles to add header bar and collapse behavior.

```css
.container {
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  overflow: hidden;
  margin-bottom: 12px;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  padding: 8px 14px;
  border: none;
  background: #fafafa;
  cursor: pointer;
  font-weight: 600;
  font-size: 14px;
}

.header:hover {
  background: #f0f0f0;
}

.arrow {
  color: #007aff;
  font-size: 13px;
}

.controls {
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  border-top: 1px solid #e8e8e8;
}

.control {
  display: flex;
  align-items: center;
  gap: 10px;
}

.control label {
  min-width: 40px;
  font-size: 13px;
}

.control select {
  flex: 1;
  padding: 4px 8px;
  border: 1px solid #ddd;
  border-radius: 4px;
}

.control input[type="range"] {
  flex: 1;
}
```

**Step 3: Verify build succeeds**

Run: `cd frontend && npm run build`
Expected: No TypeScript errors, build succeeds.

**Step 4: Manually test**

- Open TTSSynthesis page, CosyVoice engine
- Verify parameter panel is collapsed by default
- Click header to expand — controls appear
- Click header to collapse — controls hide
- Switch to Edge-TTS — parameter panel should not appear (existing behavior)

---

### Task 3: VoiceList — Add "Clear All" Button

**Files:**
- Modify: `frontend/src/components/VoiceClone/VoiceList.tsx`

**Step 1: Add "Clear All" button and handler**

Add a "Clear All" button next to "Sync from Qwen" in the header. Uses `voiceApi.delete` in a loop.

In `VoiceList.tsx`, add:

```typescript
const handleClearAll = async () => {
  if (!confirm('确定要删除所有克隆声音吗？此操作不可撤销。')) return;
  // 逐个删除所有声音，即使某个失败也继续
  for (const voice of [...voices]) {
    try {
      await voiceApi.delete(voice.id);
    } catch (err) {
      console.error(`Failed to delete voice ${voice.id}:`, err);
    }
  }
  setVoices([]);
  onRefresh?.();
};
```

In the header JSX, add the Clear All button next to Sync from Qwen:

```tsx
<div style={headerStyle}>
  <h3 style={h3Style}>🎤 Cloned Voices</h3>
  <div style={{ display: 'flex', gap: 'var(--spacing-sm)' }}>
    <Button
      variant="secondary"
      size="sm"
      onClick={handleSyncFromQwen}
      disabled={syncing}
      loading={syncing}
    >
      🔄 Sync from Qwen
    </Button>
    <Button
      variant="danger"
      size="sm"
      onClick={handleClearAll}
      disabled={voices.length === 0}
    >
      🗑️ Clear All
    </Button>
  </div>
</div>
```

Replace the existing header block (lines 163-172) with the above.

**Step 2: Verify build succeeds**

Run: `cd frontend && npm run build`
Expected: No TypeScript errors, build succeeds.

**Step 3: Manually test**

- Open VoiceClone page
- Verify "Clear All" button appears next to "Sync from Qwen"
- With no voices, button should be disabled
- With voices, click Clear All → confirm dialog appears
- Cancel → no changes
- Confirm → all voices deleted, list refreshes

---

### Summary

| Task | Files Changed | Type |
|---|---|---|
| 1. VoiceSelector dropdown | `VoiceSelector.tsx`, `.module.css`, `TTSSynthesis.tsx` | Refactor |
| 2. ParameterControls collapsible | `ParameterControls.tsx`, `.module.css` | Enhancement |
| 3. VoiceList Clear All | `VoiceList.tsx` | Enhancement |