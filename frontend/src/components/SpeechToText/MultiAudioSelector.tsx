import { useState, useEffect, useCallback } from 'react';
import type { TTSResultRecord } from '../../types';
import type { TTSLocalRecord } from '../../types';
import { ttsApi } from '../../services/api';
import { getTTSHistory } from '../../services/indexedDB';
import { useStorageMode } from '../../hooks/useStorageMode';
import styles from './MultiAudioSelector.module.css';

interface AudioItem {
  id: string;
  label: string;
  /** 后端模式：音频 URL；前端模式：base64 */
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
  const [expanded, setExpanded] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<string[]>([]);

  // 加载可选音频列表
  useEffect(() => {
    if (!expanded) return;
    (mode === 'frontend' ? loadFrontendHistory() : loadBackendHistory()).then(setItems);
  }, [expanded, mode]);

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
        // 前端存储模式：Blob URL → Blob
        const resp = await fetch(item.audioBase64);
        blob = await resp.blob();
      } else if (item.audioUrl) {
        // 后端存储模式：通过 API 获取音频
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
      <button
        className={styles.toggle}
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? '收起' : '展开'} 多音频合并转写
      </button>

      {expanded && (
        <div className={styles.panel}>
          <div className={styles.selectSection}>
            <h3>可选音频（{items.length}）</h3>
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

          {selectedList.length > 0 && (
            <div className={styles.orderSection}>
              <h3>合并顺序（已选 {selectedList.length} 项，可拖拽排序）</h3>
              <div className={styles.orderList}>
                {selectedList.map((it, idx) => (
                  <div key={it.id} className={styles.orderItem}>
                    <span className={styles.orderIndex}>{idx + 1}.</span>
                    <span className={styles.orderLabel}>{it.label}</span>
                    <div className={styles.orderActions}>
                      <button onClick={() => moveUp(it.id)} disabled={idx === 0}>▲</button>
                      <button onClick={() => moveDown(it.id)} disabled={idx === selectedList.length - 1}>▼</button>
                      <button onClick={() => toggleSelect(it.id)}>✕</button>
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
            </div>
          )}
        </div>
      )}
    </div>
  );
}