import { useState, useEffect, useCallback } from 'react';
import type { TTSLocalRecord } from '../../types';
import { ttsApi } from '../../services/api';
import { getTTSHistory } from '../../services/indexedDB';
import { useStorageMode } from '../../hooks/useStorageMode';
import styles from './MultiAudioSelector.module.css';

interface AudioItem {
  id: string;
  label: string;
  audioUrl?: string;
  audioBase64?: string;
  audio_format?: string;
  selected: boolean;
}

interface MultiAudioSelectorProps {
  onTranscribe: (files: File[]) => void;
  processing: boolean;
}

/** 从后端 TTS 历史加载可选音频列表 */
async function loadBackendHistory(): Promise<AudioItem[]> {
  const records = await ttsApi.getHistory();
  return records.map((r) => ({
    id: r.id,
    label: `${r.voice_name || r.voice_id} — ${r.text.slice(0, 30)}`,
    audioUrl: r.audio_url,
    audio_format: r.audio_format || 'mp3',
    selected: false,
  }));
}

/** 从 IndexedDB 加载可选音频列表 */
async function loadFrontendHistory(): Promise<AudioItem[]> {
  return (await getTTSHistory()).map((r: TTSLocalRecord) => ({
    id: r.id,
    label: `${r.voice_name} — ${r.text.slice(0, 30)}`,
    audioBase64: URL.createObjectURL(r.audioBlob),
    audio_format: r.audio_format,
    selected: false,
  }));
}

export function MultiAudioSelector({ onTranscribe, processing }: MultiAudioSelectorProps) {
  const { mode } = useStorageMode();
  const [items, setItems] = useState<AudioItem[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<string[]>([]);

  // 始终加载可选音频列表
  useEffect(() => {
    (mode === 'frontend' ? loadFrontendHistory() : loadBackendHistory()).then(setItems);
  }, [mode]);

  // checkbox 切换选中
  const toggleSelect = useCallback((id: string) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, selected: !it.selected } : it)));
    setSelectedOrder((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }, []);

  // 选中项排序
  const moveUp = useCallback((id: string) => {
    setSelectedOrder((prev) => {
      const idx = prev.indexOf(id);
      if (idx <= 0) return prev;
      const next = [...prev];
      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      return next;
    });
  }, []);

  const moveDown = useCallback((id: string) => {
    setSelectedOrder((prev) => {
      const idx = prev.indexOf(id);
      if (idx < 0 || idx >= prev.length - 1) return prev;
      const next = [...prev];
      [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
      return next;
    });
  }, []);

  // 执行合并转写：按顺序收集选中项，构建 File 列表上传
  const handleMergeTranscribe = useCallback(async () => {
    const orderedItems = selectedOrder
      .map((id) => items.find((it) => it.id === id))
      .filter(Boolean) as AudioItem[];

    if (orderedItems.length === 0) {
      alert('请至少选择一个音频');
      return;
    }

    const files: File[] = [];
    for (const item of orderedItems) {
      let blob: Blob;
      if (item.audioBase64) {
        const resp = await fetch(item.audioBase64);
        blob = await resp.blob();
      } else if (item.audioUrl) {
        const resp = await fetch(item.audioUrl);
        blob = await resp.blob();
      } else {
        continue;
      }
      files.push(new File([blob], `${item.id}.${item.audio_format || 'mp3'}`, { type: blob.type }));
    }

    onTranscribe(files);
  }, [selectedOrder, items, onTranscribe]);

  const selectedList = selectedOrder
    .map((id) => items.find((it) => it.id === id))
    .filter(Boolean) as AudioItem[];

  return (
    <div className={styles.container}>
      <div className={styles.cardHeader}>
        <div>
          <div className={styles.title}>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M4 6h4v8H4V6zM10 4h6v12h-6V4z" fill="currentColor" opacity="0.3"/>
              <path d="M4 14l4-4 3 3 3-5 4 6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
            </svg>
            多音频合并转写
            <span className={styles.badge}>
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path d="M5 1L6.5 3.5L9.5 4L7.25 6L7.75 9L5 7.5L2.25 9L2.75 6L0.5 4L3.5 3.5L5 1Z" fill="currentColor"/>
              </svg>
              高级功能
            </span>
          </div>
          <div className={styles.subtitle}>
            从文字转语音的历史记录中选择多个音频，按顺序合并后进行语音识别
          </div>
        </div>
      </div>

      <div className={styles.panel}>
        <div className={styles.selectSection}>
          <h3>
            可选音频
            <span className={styles.count}>{items.length}</span>
          </h3>
          <div className={styles.list}>
            {items.map((it) => (
              <label key={it.id} className={styles.item}>
                <input
                  type="checkbox"
                  checked={it.selected}
                  onChange={() => toggleSelect(it.id)}
                />
                <span className={styles.label}>{it.label}</span>
              </label>
            ))}
            {items.length === 0 && (
              <div className={styles.emptyHint}>暂无合成音频，请先在"文字转语音"页合成语音</div>
            )}
          </div>
        </div>

        <div className={styles.orderSection}>
          <h3>
            合并顺序
            <span className={styles.count}>{selectedList.length}</span>
          </h3>
          {selectedList.length > 0 ? (
            <>
              <div className={styles.orderList}>
                {selectedList.map((it, idx) => (
                  <div key={it.id} className={styles.orderItem}>
                    <span className={styles.orderIndex}>{idx + 1}.</span>
                    <span className={styles.orderLabel}>{it.label}</span>
                    <div className={styles.orderActions}>
                      <button onClick={() => moveUp(it.id)} disabled={idx === 0} title="上移">▲</button>
                      <button onClick={() => moveDown(it.id)} disabled={idx === selectedList.length - 1} title="下移">▼</button>
                      <button onClick={() => toggleSelect(it.id)} title="移除">✕</button>
                    </div>
                  </div>
                ))}
              </div>
              <button
                className={styles.mergeButton}
                onClick={handleMergeTranscribe}
                disabled={processing || selectedList.length === 0}
              >
                {processing ? '合并转写中...' : `合并并转写 (${selectedList.length} 个文件)`}
              </button>
            </>
          ) : (
            <div className={styles.emptyHint}>勾选左侧音频后，按添加顺序排列</div>
          )}
        </div>
      </div>
    </div>
  );
}