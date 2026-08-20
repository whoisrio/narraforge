import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { recordDownloadAndCheckUpsell } from './tryUpsell';
import { buildRecordingsZip, downloadName } from './tryExport';
import { getAdminContactEmail } from '../services/contact';
import { stashTryHandoffText } from './tryHandoff';
import { distinctLanguages, filterEdgeVoices } from './voiceFilter';
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

interface CurrentAudio {
  url: string;
  text: string;
}

/** 品牌小标识：四条声波柱 */
function WaveMark({ className }: { className?: string }) {
  return (
    <span className={className ?? styles.waveMark} aria-hidden="true">
      <i /><i /><i /><i />
    </span>
  );
}

/**
 * Try 页（/try）：粘贴整份文档 → edge_tts 一键合成。
 * 无分段/无项目/无需登录；数据只存浏览器 IndexedDB。
 * 设计：docs/superpowers/specs/2026-08-20-try-page-seo-acquisition-design.md
 */
export function TryPage() {
  const [text, setText] = useState('');
  const [allVoices, setAllVoices] = useState<EdgeVoice[]>([]);
  const [language, setLanguage] = useState('English');
  const [gender, setGender] = useState('');
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
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // object URL 生命周期：在 effect cleanup 里吊销上一个 URL——
  // cleanup 发生于新 src 已提交到 DOM 之后，不会吊销正在播放的地址
  const currentUrl = current?.url ?? null;
  useEffect(() => {
    return () => {
      if (currentUrl) URL.revokeObjectURL(currentUrl);
    };
  }, [currentUrl]);

  // 生成完成 / 点击历史 Play 后自动开播；autoplay 被浏览器拦截时静默兜底（用户可手点原生播放键）
  useEffect(() => {
    if (current && audioRef.current) {
      audioRef.current.play().catch(() => {});
    }
  }, [current]);

  useEffect(() => {
    void (async () => {
      // 微软音色列表偶发网络失败：自动重试一次
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const items = await ttsApi.getEdgeVoices();
          setAllVoices(items);
          return;
        } catch (err) {
          console.error('Failed to load voices:', err);
          if (attempt === 0) await new Promise((r) => setTimeout(r, 800));
        }
      }
    })();
    void listTryTTSRecords().then(setHistory).catch(() => {});
  }, []);

  const languages = useMemo(() => distinctLanguages(allVoices), [allVoices]);
  const filteredVoices = useMemo(
    () => filterEdgeVoices(allVoices, { language, gender }),
    [allVoices, language, gender],
  );

  // 过滤条件变化后，当前选中音色不在结果集时回退到第一个
  useEffect(() => {
    if (filteredVoices.length === 0) {
      setVoice('');
      return;
    }
    if (!filteredVoices.some((v) => v.short_name === voice)) {
      setVoice(filteredVoices[0].short_name);
    }
  }, [filteredVoices, voice]);

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
      const voiceName = allVoices.find((v) => v.short_name === voice)?.display_name ?? voice;
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
      setCurrent({ url: URL.createObjectURL(blob), text });
    } catch (err) {
      if (apiErrorCode(err) === 'rate_limit_exceeded') {
        setRateLimited(true);
      } else {
        setError(err instanceof Error ? err.message : 'Generation failed. Please try again.');
      }
    } finally {
      setIsGenerating(false);
    }
  }, [validation, isGenerating, voice, text, rate, volume, allVoices]);

  const handlePlayRecord = useCallback((record: TTSLocalRecord) => {
    setCurrent({ url: URL.createObjectURL(record.audioBlob), text: record.text });
  }, []);

  const handleDownload = useCallback((record: TTSLocalRecord) => {
    // 页面停留期间每下载 5 次弹一次推荐确认（刷新归零）
    if (recordDownloadAndCheckUpsell()) {
      pendingDownload.current = record;
      setUpsellOpen(true);
      return;
    }
    downloadBlob(record.audioBlob, downloadName(record));
  }, []);

  const handleDownloadAll = useCallback(async () => {
    if (history.length === 0) return;
    const zip = await buildRecordingsZip(history);
    downloadBlob(zip, 'narraforge-recordings.zip');
  }, [history]);

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
        <span className={styles.brand}>
          <WaveMark />
          NarraForge <span className={styles.brandTry}>Try</span>
        </span>
        <span className={styles.headerActions}>
          {getAdminContactEmail() && (
            <a className={styles.contactLink} href={`mailto:${getAdminContactEmail()}`}>
              Contact us
            </a>
          )}
          <button type="button" className={styles.ctaButton} onClick={handleTryFullVersion}>
            Try full version →
          </button>
        </span>
      </header>

      <main className={styles.main}>
        <section className={styles.toolCard} aria-label="Text to speech">
          <div className={styles.textareaWrap}>
            <textarea
              className={styles.textarea}
              placeholder="Paste your document here — article, story, script, anything. Up to 3,000 characters."
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={9}
            />
            <span
              data-testid="char-count"
              className={text.length > TRY_TEXT_MAX_CHARS ? styles.charCountOver : styles.charCount}
            >
              {text.length.toLocaleString()} / {TRY_TEXT_MAX_CHARS.toLocaleString()}
            </span>
          </div>
          {!validation.ok && validation.reason === 'too_long' && (
            <p className={styles.limitWarning}>
              This demo supports up to 3,000 characters per generation.
            </p>
          )}

          <div className={styles.voiceRow}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Language</span>
              <select
                aria-label="Language"
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
              >
                {languages.map((l) => (
                  <option key={l} value={l}>{l}</option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Gender</span>
              <select
                aria-label="Gender"
                value={gender}
                onChange={(e) => setGender(e.target.value)}
              >
                <option value="">All</option>
                <option value="Female">Female</option>
                <option value="Male">Male</option>
              </select>
            </label>
            <label className={`${styles.field} ${styles.fieldGrow}`}>
              <span className={styles.fieldLabel}>Voice</span>
              <select
                aria-label="Voice"
                value={voice}
                onChange={(e) => setVoice(e.target.value)}
              >
                {filteredVoices.map((v) => (
                  <option key={v.short_name} value={v.short_name}>
                    {v.display_name} ({v.locale})
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className={styles.sliderRow}>
            <label className={styles.sliderField}>
              <span className={styles.fieldLabel}>Speed <em>{toEdgeFormat(rate)}</em></span>
              <input
                type="range"
                min={-50}
                max={100}
                step={5}
                value={rate}
                onChange={(e) => setRate(Number(e.target.value))}
              />
            </label>
            <label className={styles.sliderField}>
              <span className={styles.fieldLabel}>Volume <em>{toEdgeFormat(volume)}</em></span>
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
            {isGenerating ? (
              <>
                <WaveMark className={styles.waveMarkActive} />
                Generating…
              </>
            ) : (
              'Generate speech'
            )}
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
            <div className={styles.playerCard}>
              <WaveMark className={styles.playerWave} />
              <div className={styles.playerBody}>
                <p className={styles.playerText} title={current.text}>{current.text}</p>
                <audio
                  ref={audioRef}
                  data-testid="audio-player"
                  className={styles.player}
                  controls
                  src={current.url}
                />
              </div>
            </div>
          )}
        </section>

        <aside className={styles.historyRail} aria-label="Recordings">
          <div className={styles.historyHeader}>
            <h2 className={styles.historyTitle}>
              Recordings
              {history.length > 0 && <span className={styles.countBadge}>{history.length}</span>}
            </h2>
            {history.length > 0 && (
              <span className={styles.historyHeaderActions}>
                <button
                  type="button"
                  className={styles.downloadAllButton}
                  onClick={() => void handleDownloadAll()}
                >
                  Download all
                </button>
                <button
                  type="button"
                  className={styles.clearButton}
                  onClick={() => setConfirmClearOpen(true)}
                >
                  Clear all
                </button>
              </span>
            )}
          </div>
          {history.length === 0 ? (
            <p className={styles.historyEmpty}>
              Nothing here yet — generate your first recording and it will show up here,
              stored only in this browser.
            </p>
          ) : (
            <ul data-testid="history-list" className={styles.historyList}>
              {history.map((record) => (
                <li key={record.id} className={styles.historyItem}>
                  <p className={styles.historyText}>{record.text}</p>
                  <div className={styles.historyMetaRow}>
                    <span className={styles.historyVoice}>
                      {record.voice_name} · {new Date(record.created_at).toLocaleString()}
                    </span>
                    <span className={styles.historyActions}>
                      <button type="button" className={styles.playButton} title="Play" onClick={() => handlePlayRecord(record)}>
                        <span aria-hidden="true">▶</span> Play
                      </button>
                      <button type="button" className={styles.actionButton} title="Download" onClick={() => handleDownload(record)}>
                        <span aria-hidden="true">⬇</span> Download
                      </button>
                      <button type="button" className={styles.deleteButton} title="Delete" onClick={() => void handleDeleteRecord(record.id)}>
                        <span aria-hidden="true">✕</span> Delete
                      </button>
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </aside>
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
              <button type="button" className={styles.cancelButton} onClick={() => setConfirmClearOpen(false)}>Cancel</button>
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
