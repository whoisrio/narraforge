import { useCallback, useEffect, useRef, useState } from 'react';
import { ttsApi, apiErrorCode } from '../services/api';
import { apiUrl } from '../services/apiBase';
import type { EdgeVoice, TTSLocalRecord } from '../types';
import { TRY_TEXT_MAX_CHARS, validateTryText } from './tryLimits';
import {
  saveTryTTSRecord,
  listTryTTSRecords,
  deleteTryTTSRecord,
  clearTryTTSRecords,
} from './tryHistory';
import { shouldShowDownloadUpsell, markDownloadUpsellShown } from './tryUpsell';
import { stashTryHandoffText } from './tryHandoff';
import styles from './TryPage.module.css';

function toEdgeFormat(value: number): string {
  return value >= 0 ? `+${value}%` : `${value}%`;
}

function base64ToBlob(base64: string, format: string): Blob {
  const bytes = atob(base64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type: format === 'wav' ? 'audio/wav' : 'audio/mpeg' });
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function downloadName(record: TTSLocalRecord): string {
  return `narraforge-${record.id}.${record.audio_format || 'mp3'}`;
}

interface CurrentAudio {
  url: string;
  text: string;
}

/**
 * Try 页（/try）：粘贴整份文档 → edge_tts 一键合成。
 * 无分段/无项目/无需登录；数据只存浏览器 IndexedDB。
 * 设计：docs/superpowers/specs/2026-08-20-try-page-seo-acquisition-design.md
 */
export function TryPage() {
  const [text, setText] = useState('');
  const [voices, setVoices] = useState<EdgeVoice[]>([]);
  const [voice, setVoice] = useState('');
  const [rate, setRate] = useState(0);
  const [volume, setVolume] = useState(0);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState('');
  const [rateLimited, setRateLimited] = useState(false);
  const [current, setCurrent] = useState<CurrentAudio | null>(null);
  const [history, setHistory] = useState<TTSLocalRecord[]>([]);
  const [upsellOpen, setUpsellOpen] = useState(false);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const pendingDownload = useRef<TTSLocalRecord | null>(null);

  useEffect(() => {
    void (async () => {
      // 微软音色列表偶发网络失败：自动重试一次
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const items = await ttsApi.getEdgeVoices('English');
          setVoices(items);
          if (items.length > 0) setVoice((v) => v || items[0].short_name);
          return;
        } catch (err) {
          console.error('Failed to load voices:', err);
          if (attempt === 0) await new Promise((r) => setTimeout(r, 800));
        }
      }
    })();
    void listTryTTSRecords().then(setHistory).catch(() => {});
  }, []);

  const validation = validateTryText(text);

  const handleGenerate = useCallback(async () => {
    if (!validation.ok || isGenerating || !voice) return;
    setIsGenerating(true);
    setError('');
    setRateLimited(false);
    try {
      const result = await ttsApi.synthesize({
        text,
        engine: 'edge_tts',
        voice_id: '',
        edge_voice: voice,
        edge_rate: toEdgeFormat(rate),
        edge_volume: toEdgeFormat(volume),
        format: 'mp3',
      });
      const format = result.audio_format || 'mp3';
      // 匿名/workers：audio_base64 直回；local + backend 存储模式：回 audio_url，需回取
      let blob: Blob;
      if (result.audio_base64) {
        blob = base64ToBlob(result.audio_base64, format);
      } else if (result.audio_url) {
        // 后端 audio_url 自带 /api 前缀；剥掉后再拼 API_BASE_URL，避免 /api/api 双重前缀
        const path = result.audio_url.replace(/^\/api(?=\/)/, '');
        const audioResp = await fetch(apiUrl(path));
        if (!audioResp.ok) throw new Error('Failed to fetch audio');
        blob = await audioResp.blob();
      } else {
        throw new Error('No audio returned');
      }
      const voiceName = voices.find((v) => v.short_name === voice)?.display_name ?? voice;
      const record: TTSLocalRecord = {
        id: crypto.randomUUID(),
        text,
        voice_id: voice,
        voice_name: voiceName,
        audioBlob: blob,
        audio_format: format,
        speed: 1,
        volume: 100,
        pitch: 1,
        instruction: '',
        language: 'English',
        created_at: new Date().toISOString(),
      };
      await saveTryTTSRecord(record);
      setHistory((prev) => [record, ...prev]);
      setCurrent((prev) => {
        if (prev) URL.revokeObjectURL(prev.url);
        return { url: URL.createObjectURL(blob), text };
      });
    } catch (err) {
      if (apiErrorCode(err) === 'rate_limit_exceeded') {
        setRateLimited(true);
      } else {
        setError(err instanceof Error ? err.message : 'Generation failed. Please try again.');
      }
    } finally {
      setIsGenerating(false);
    }
  }, [validation, isGenerating, voice, text, rate, volume, voices]);

  const handlePlayRecord = useCallback((record: TTSLocalRecord) => {
    setCurrent((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return { url: URL.createObjectURL(record.audioBlob), text: record.text };
    });
  }, []);

  const handleDownload = useCallback((record: TTSLocalRecord) => {
    if (shouldShowDownloadUpsell()) {
      markDownloadUpsellShown();
      pendingDownload.current = record;
      setUpsellOpen(true);
      return;
    }
    downloadBlob(record.audioBlob, downloadName(record));
  }, []);

  const handleUpsellContinue = useCallback(() => {
    const record = pendingDownload.current;
    pendingDownload.current = null;
    setUpsellOpen(false);
    if (record) downloadBlob(record.audioBlob, downloadName(record));
  }, []);

  const handleDeleteRecord = useCallback(async (id: string) => {
    await deleteTryTTSRecord(id);
    setHistory((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const handleClearAll = useCallback(async () => {
    await clearTryTTSRecords();
    setHistory([]);
    setConfirmClearOpen(false);
  }, []);

  const handleTryFullVersion = useCallback(() => {
    stashTryHandoffText(text);
    window.location.href = '/';
  }, [text]);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <span className={styles.brand}>NarraForge</span>
        <button type="button" className={styles.ctaButton} onClick={handleTryFullVersion}>
          Try full version
        </button>
      </header>

      <main className={styles.main}>
        <section className={styles.toolCard}>
          <textarea
            className={styles.textarea}
            placeholder="Paste your document here — article, story, script, anything. Up to 3,000 characters."
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={10}
          />
          <div className={styles.toolRow}>
            <span
              data-testid="char-count"
              className={text.length > TRY_TEXT_MAX_CHARS ? styles.charCountOver : styles.charCount}
            >
              {text.length.toLocaleString()} / {TRY_TEXT_MAX_CHARS.toLocaleString()}
            </span>
            {!validation.ok && validation.reason === 'too_long' && (
              <span className={styles.limitWarning}>
                This demo supports up to 3,000 characters per generation.
              </span>
            )}
          </div>

          <div className={styles.controls}>
            <label className={styles.field}>
              Voice
              <select
                aria-label="Voice"
                value={voice}
                onChange={(e) => setVoice(e.target.value)}
              >
                {voices.map((v) => (
                  <option key={v.short_name} value={v.short_name}>
                    {v.display_name} ({v.locale})
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              Speed {toEdgeFormat(rate)}
              <input
                type="range"
                min={-50}
                max={100}
                step={5}
                value={rate}
                onChange={(e) => setRate(Number(e.target.value))}
              />
            </label>
            <label className={styles.field}>
              Volume {toEdgeFormat(volume)}
              <input
                type="range"
                min={-50}
                max={100}
                step={5}
                value={volume}
                onChange={(e) => setVolume(Number(e.target.value))}
              />
            </label>
          </div>

          <button
            type="button"
            className={styles.generateButton}
            disabled={!validation.ok || isGenerating || !voice}
            onClick={() => void handleGenerate()}
          >
            {isGenerating ? 'Generating…' : 'Generate speech'}
          </button>

          {rateLimited && (
            <p className={styles.errorBanner} role="alert">
              You have reached the daily free trial limit.{' '}
              <a href="/">Sign up for the full version</a> to keep going.
            </p>
          )}
          {error && (
            <p className={styles.errorBanner} role="alert">{error}</p>
          )}

          {current && (
            <audio data-testid="audio-player" className={styles.player} controls src={current.url} />
          )}
        </section>

        <section className={styles.historySection}>
          <div className={styles.historyHeader}>
            <h2 className={styles.historyTitle}>Your recordings</h2>
            {history.length > 0 && (
              <button
                type="button"
                className={styles.clearButton}
                onClick={() => setConfirmClearOpen(true)}
              >
                Clear all
              </button>
            )}
          </div>
          {history.length === 0 ? (
            <p className={styles.historyEmpty}>
              Generated audio is stored in your browser only — replay or download it anytime.
            </p>
          ) : (
            <ul data-testid="history-list" className={styles.historyList}>
              {history.map((record) => (
                <li key={record.id} className={styles.historyItem}>
                  <div className={styles.historyMeta}>
                    <span className={styles.historyText}>{record.text}</span>
                    <span className={styles.historyVoice}>
                      {record.voice_name} · {new Date(record.created_at).toLocaleString()}
                    </span>
                  </div>
                  <div className={styles.historyActions}>
                    <button type="button" onClick={() => handlePlayRecord(record)}>Play</button>
                    <button type="button" onClick={() => handleDownload(record)}>Download</button>
                    <button type="button" onClick={() => void handleDeleteRecord(record.id)}>Delete</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>

      {upsellOpen && (
        <div className={styles.modalBackdrop}>
          <div className={styles.modal} role="dialog" aria-label="Full version">
            <h3>Enjoying NarraForge?</h3>
            <p>
              With the full version you can save projects, sync across devices,
              unlock premium MiMo voices, and synthesize long documents chapter by chapter.
            </p>
            <div className={styles.modalActions}>
              <button type="button" className={styles.generateButton} onClick={handleUpsellContinue}>
                Continue download
              </button>
              <button type="button" className={styles.ctaButton} onClick={handleTryFullVersion}>
                Try full version
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmClearOpen && (
        <div className={styles.modalBackdrop}>
          <div className={styles.modal} role="dialog" aria-label="Clear history">
            <h3>Clear all recordings?</h3>
            <p>This permanently deletes all generated audio stored in this browser.</p>
            <div className={styles.modalActions}>
              <button type="button" onClick={() => setConfirmClearOpen(false)}>Cancel</button>
              <button
                type="button"
                className={styles.dangerButton}
                onClick={() => void handleClearAll()}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
