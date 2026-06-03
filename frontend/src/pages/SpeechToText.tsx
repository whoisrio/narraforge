import { useState, useRef, useCallback, useEffect } from 'react';
import { speechToTextApi, subtitleLlmApi } from '../services/api';
import type { TranscribeResult, TranscriptionRecord, CorrectionSuggestion, BilingualSegment } from '../services/api';

/** 字符级 diff：将 original 和 suggested 分成 changed/unchanged 片段 */
function computeCharDiff(original: string, suggested: string) {
  // 找最长公共子序列的简化版 — 从两端向中间收缩
  let prefixLen = 0;
  while (prefixLen < original.length && prefixLen < suggested.length && original[prefixLen] === suggested[prefixLen]) prefixLen++;
  let suffixLen = 0;
  while (
    suffixLen < original.length - prefixLen &&
    suffixLen < suggested.length - prefixLen &&
    original[original.length - 1 - suffixLen] === suggested[suggested.length - 1 - suffixLen]
  ) suffixLen++;

  const origMid = original.slice(prefixLen, original.length - suffixLen);
  const suggMid = suggested.slice(prefixLen, suggested.length - suffixLen);
  const prefix = original.slice(0, prefixLen);
  const suffix = original.slice(original.length - suffixLen);

  const left: { text: string; changed: boolean }[] = [];
  const right: { text: string; changed: boolean }[] = [];
  if (prefix) { left.push({ text: prefix, changed: false }); right.push({ text: prefix, changed: false }); }
  if (origMid) left.push({ text: origMid, changed: true });
  if (suggMid) right.push({ text: suggMid, changed: true });
  if (suffix) { left.push({ text: suffix, changed: false }); right.push({ text: suffix, changed: false }); }
  return { left, right };
}
import { saveSTTResult, getSTTHistory, deleteSTTResult } from '../services/indexedDB';
import { useStorageMode } from '../hooks/useStorageMode';
import { Button } from '../components/ui/Button';
import { Select } from '../components/ui/Select';
import { Slider } from '../components/ui/Slider';
import { Loading } from '../components/ui/Loading';
import { TranscriptionHistory } from '../components/SpeechToText';
import { MultiAudioSelector } from '../components/SpeechToText';
import styles from './SpeechToText.module.css';

const ENGINE_OPTIONS = [
  { value: 'whisper', label: 'Whisper (多语言)' },
  { value: 'funasr', label: 'FunASR (中文优化)' },
];

const WHISPER_MODEL_OPTIONS = [
  { value: 'tiny', label: 'Tiny (最快)' },
  { value: 'base', label: 'Base' },
  { value: 'small', label: 'Small' },
  { value: 'medium', label: 'Medium' },
  { value: 'large-v3', label: 'Large-v3 (最准)' },
];

const FUNASR_MODEL_OPTIONS = [
  { value: 'paraformer-zh', label: 'Paraformer-ZH (中文)' },
  { value: 'paraformer-zh-streaming', label: 'Paraformer-ZH Streaming' },
];

export function SpeechToText() {
  const { mode: storageMode } = useStorageMode();
  const [file, setFile] = useState<File | null>(null);
  const [engine, setEngine] = useState('whisper');
  const [modelSize, setModelSize] = useState('large-v3');
  const [beamSize, setBeamSize] = useState(5);
  const [enableVad, setEnableVad] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<TranscribeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [history, setHistory] = useState<TranscriptionRecord[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const multiAudioRef = useRef<HTMLDivElement>(null);

  // LLM 校准状态
  const [originalDoc, setOriginalDoc] = useState('');
  const [correctionMode, setCorrectionMode] = useState<'smart' | 'full'>('smart');
  const [suggestions, setSuggestions] = useState<CorrectionSuggestion[]>([]);
  const [correcting, setCorrecting] = useState(false);
  const [correctionModel, setCorrectionModel] = useState<string | null>(null);
  const [acceptedSuggestions, setAcceptedSuggestions] = useState<Set<number>>(new Set());

  // 双语字幕状态
  const [bilingualSegments, setBilingualSegments] = useState<BilingualSegment[]>([]);
  const [bilingualSrt, setBilingualSrt] = useState('');
  const [translating, setTranslating] = useState(false);
  const [targetLang, setTargetLang] = useState('English');

  // 用 ref 跟踪当前模式，避免异步竞态
  const storageModeRef = useRef(storageMode);
  storageModeRef.current = storageMode;

  // 保存 blob URL 以便清理，避免内存泄漏
  const blobUrlsRef = useRef<string[]>([]);

  const revokeBlobUrls = useCallback(() => {
    blobUrlsRef.current.forEach(url => URL.revokeObjectURL(url));
    blobUrlsRef.current = [];
  }, []);

  const handleFileSelect = useCallback((selectedFile: File) => {
    const ext = selectedFile.name.split('.').pop()?.toLowerCase();
    if (ext !== 'wav' && ext !== 'mp3') {
      setError('Only .wav and .mp3 files are supported');
      return;
    }
    setFile(selectedFile);
    setResult(null);
    setError(null);
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl(URL.createObjectURL(selectedFile));
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const droppedFile = e.dataTransfer.files[0];
      if (droppedFile) handleFileSelect(droppedFile);
    },
    [handleFileSelect],
  );

  // 切换引擎时自动选择对应默认模型
  const handleEngineChange = (newEngine: string) => {
    setEngine(newEngine);
    if (newEngine === 'whisper') setModelSize('large-v3');
    else setModelSize('paraformer-zh');
  };

  const handleTranscribe = async () => {
    if (!file) return;
    setProcessing(true);
    setError(null);
    try {
      const res = await speechToTextApi.transcribe(file, modelSize, beamSize, engine, enableVad);
      // enableVad only relevant for funasr
      setResult(res);

      // 前端存储模式：将识别结果存入 IndexedDB
      if (storageMode === 'frontend') {
        await saveSTTResult({
          id: res.file_id,
          original_filename: file.name,
          audioBlob: file, // 保存原始音频文件，以便历史回放
          srtContent: res.content,
          language: res.language,
          language_probability: res.language_probability,
          model_size: modelSize,
          created_at: new Date().toISOString(),
        });
      }

      loadHistory();
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Transcription failed');
    } finally {
      setProcessing(false);
    }
  };

  const handleDownload = () => {
    if (!result || !file) return;
    const stem = file.name.replace(/\.[^.]+$/, '');
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const filename = `${stem}_${date}.srt`;
    const blob = new Blob([result.content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const loadHistory = useCallback(async () => {
    const modeAtStart = storageModeRef.current;
    try {
      if (modeAtStart === 'frontend') {
        // 前端存储模式：从 IndexedDB 加载，映射为 TranscriptionRecord 格式
        const localRecords = await getSTTHistory();
        if (storageModeRef.current !== modeAtStart) return;

        // 清理旧的 blob URL，为每条记录生成新的
        revokeBlobUrls();

        const mapped: TranscriptionRecord[] = localRecords.map((r) => {
          // 旧记录可能没有 audioBlob，此时不生成播放 URL
          const audioUrl = r.audioBlob ? URL.createObjectURL(r.audioBlob) : '';
          if (audioUrl) blobUrlsRef.current.push(audioUrl);

          // 为 SRT 内容生成 blob URL，以便历史下载
          const srtBlob = new Blob([r.srtContent || ''], { type: 'text/plain;charset=utf-8' });
          const srtUrl = URL.createObjectURL(srtBlob);
          blobUrlsRef.current.push(srtUrl);

          return {
            id: r.id,
            original_filename: r.original_filename,
            audio_url: audioUrl,
            srt_download_url: srtUrl,
            language: r.language,
            language_probability: r.language_probability,
            model_size: r.model_size,
            created_at: r.created_at,
          };
        });
        setHistory(mapped);
      } else {
        const data = await speechToTextApi.getHistory();
        if (storageModeRef.current !== modeAtStart) return;
        setHistory(data);
      }
    } catch (error) {
      console.error('Failed to load history:', error);
    }
  }, []);

  useEffect(() => { loadHistory(); }, [storageMode, loadHistory]);

  // 组件卸载时清理 blob URL，避免内存泄漏
  useEffect(() => {
    return () => {
      revokeBlobUrls();
    };
  }, [revokeBlobUrls]);

  const handleDeleteRecord = useCallback(async (id: string) => {
    try {
      if (storageMode === 'frontend') {
        await deleteSTTResult(id);
      } else {
        await speechToTextApi.deleteRecord(id);
      }
      setHistory(prev => prev.filter(r => r.id !== id));
    } catch (error) {
      console.error('Failed to delete record:', error);
    }
  }, [storageMode]);

  // ---- LLM 字幕校准 ----
  const handleCorrect = async () => {
    if (!result?.content) return;
    if (!originalDoc.trim()) {
      setError('请先粘贴原始文稿，再进行校准');
      return;
    }
    setCorrecting(true);
    setError(null);
    setSuggestions([]);
    setAcceptedSuggestions(new Set());
    try {
      const res = await subtitleLlmApi.correct(result.content, originalDoc, 'zh', correctionMode);
      setSuggestions(res.suggestions);
      setCorrectionModel(res.model);
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'LLM 校准失败，请检查 .env 中的 LLM 配置');
    } finally {
      setCorrecting(false);
    }
  };

  const toggleAcceptSuggestion = (index: number) => {
    setAcceptedSuggestions(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const applyCorrections = () => {
    if (!result || acceptedSuggestions.size === 0) return;
    let content = result.content;
    const sorted = [...suggestions]
      .filter(s => acceptedSuggestions.has(s.index))
      .sort((a, b) => {
        // 按在原文中的位置倒序替换，避免偏移
        const posA = content.indexOf(a.original);
        const posB = content.indexOf(b.original);
        return posB - posA;
      });
    for (const s of sorted) {
      content = content.replace(s.original, s.suggested);
    }
    setResult({ ...result, content });
    setSuggestions([]);
    setAcceptedSuggestions(new Set());
  };

  // ---- 双语字幕 ----
  const handleTranslate = async () => {
    if (!result?.content) return;
    setTranslating(true);
    setError(null);
    try {
      const res = await subtitleLlmApi.translate(result.content, targetLang);
      setBilingualSegments(res.segments);
      setBilingualSrt(res.bilingual_srt);
    } catch (err: any) {
      setError(err?.response?.data?.detail || '翻译失败，请检查 API Key 配置');
    } finally {
      setTranslating(false);
    }
  };

  const handleDownloadBilingual = () => {
    if (!bilingualSrt || !file) return;
    const stem = file.name.replace(/\.[^.]+$/, '');
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const filename = `${stem}_${date}_bilingual.srt`;
    const blob = new Blob([bilingualSrt], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleMultiTranscribe = async (files: File[]) => {
    setProcessing(true);
    setError(null);
    try {
      const res = await speechToTextApi.multiTranscribe(files, modelSize, beamSize, engine, enableVad);
      setResult(res);

      // 前端存储模式：存入 IndexedDB
      if (storageMode === 'frontend') {
        // multi 模式下无单个 File，保存第一个文件的 Blob 作为归档
        await saveSTTResult({
          id: res.file_id,
          original_filename: 'merged_audio.mp3',
          audioBlob: files[0],
          srtContent: res.content,
          language: res.language,
          language_probability: res.language_probability,
          model_size: modelSize,
          created_at: new Date().toISOString(),
        });
      }

      loadHistory();
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Multi-transcribe failed');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1>语音转字幕</h1>
        <p>上传音频文件，使用 Whisper 或 FunASR 识别语音并生成 SRT 字幕</p>
      </div>

      <div className={styles.content}>
        <div className={styles.inputSection}>
          <div className={styles.card}>
            <h2>上传音频</h2>
            <div
              className={`${styles.uploadZone} ${dragOver ? styles.dragOver : ''} ${file ? styles.hasFile : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              {file ? (
                <>
                  <div className={styles.uploadIcon}>🎵</div>
                  <div className={styles.fileName}>{file.name}</div>
                  <div className={styles.uploadHint}>点击更换文件</div>
                </>
              ) : (
                <>
                  <div className={styles.uploadIcon}>📁</div>
                  <div className={styles.uploadText}>拖拽音频文件到此处，或点击选择</div>
                  <div className={styles.uploadHint}>支持 .wav, .mp3 格式</div>
                </>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".wav,.mp3"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFileSelect(f);
              }}
            />

            {audioUrl && (
              <div className={styles.audioPlayer}>
                <audio controls src={audioUrl} className={styles.audio} />
              </div>
            )}

            <div className={styles.params}>
              <Select
                label="识别引擎"
                options={ENGINE_OPTIONS}
                value={engine}
                onChange={(e) => handleEngineChange(e.target.value)}
              />
              <Select
                label="模型大小"
                options={engine === 'whisper' ? WHISPER_MODEL_OPTIONS : FUNASR_MODEL_OPTIONS}
                value={modelSize}
                onChange={(e) => setModelSize(e.target.value)}
              />
              {engine === 'whisper' && <Slider
                label="Beam Size"
                value={beamSize}
                onChange={setBeamSize}
                min={1}
                max={10}
                step={1}
              />}
              {engine === 'funasr' && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
                  <input
                    type="checkbox"
                    checked={enableVad}
                    onChange={(e) => setEnableVad(e.target.checked)}
                  />
                  启用 VAD (语音活动检测)
                </label>
              )}
            </div>

            <div className={styles.actionRow}>
              <Button
                variant="primary"
                fullWidth
                loading={processing}
                disabled={!file || processing}
                onClick={handleTranscribe}
              >
                {processing ? '识别中...' : '开始识别'}
              </Button>
            </div>

            <div className={styles.quickEntry}>
              <button
                type="button"
                onClick={() => multiAudioRef.current?.scrollIntoView({ behavior: 'smooth' })}
              >
                或使用「多音频合并转写」- 按顺序合并多个 TTS 音频后识别
              </button>
            </div>
          </div>
        </div>

        <div className={styles.resultSection}>
          <div className={styles.card}>
            <h2>识别结果</h2>
            {processing && (
              <div className={styles.processing}>
                <Loading size="lg" />
                <div className={styles.processingText}>正在识别语音，请耐心等待...</div>
              </div>
            )}
            {error && <div style={{ color: 'var(--color-danger)' }}>{error}</div>}
            {result && !processing && (
              <>
                <div className={styles.resultHeader}>
                  <span className={styles.languageBadge}>
                    {result.language} ({(result.language_probability * 100).toFixed(1)}%)
                  </span>
                  {result.device && (
                    <span className={`${styles.languageBadge} ${result.device === 'cuda' ? styles.gpuBadge : ''}`}>
                      {result.device === 'cuda' ? '🚀 GPU' : '💻 CPU'} ({result.compute_type})
                    </span>
                  )}
                </div>
                <textarea
                  className={styles.srtPreview}
                  value={result.content}
                  onChange={(e) => setResult({ ...result, content: e.target.value })}
                />
                <div className={styles.downloadRow}>
                  <Button variant="primary" onClick={handleDownload}>
                    下载 SRT 文件
                  </Button>
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginLeft: 8 }}>
                    <Select
                      label=""
                      options={[
                        { value: 'English', label: 'English' },
                        { value: 'Japanese', label: '日本語' },
                        { value: 'Korean', label: '한국어' },
                        { value: 'French', label: 'Français' },
                        { value: 'German', label: 'Deutsch' },
                        { value: 'Spanish', label: 'Español' },
                      ]}
                      value={targetLang}
                      onChange={(e) => setTargetLang(e.target.value)}
                    />
                    <Button
                      variant="secondary"
                      loading={translating}
                      disabled={translating}
                      onClick={handleTranslate}
                    >
                      {translating ? '翻译中...' : '🌐 双语字幕'}
                    </Button>
                  </div>
                </div>

                {/* ---- 独立校准面板 ---- */}
                <div className={styles.correctionSection}>
                  <div className={styles.correctionSectionHeader}>
                    <span className={styles.correctionSectionIcon}>📝</span>
                    <span className={styles.correctionSectionTitle}>字幕校准</span>
                    {correctionModel && <span className={styles.correctionModelBadge}>{correctionModel}</span>}
                  </div>
                  <div className={styles.correctionSectionDesc}>
                    提供原始文稿，LLM 对比识别结果，只修正错别字，不改变内容意思
                  </div>
                  <div className={styles.correctionModeRow}>
                    <button
                      className={`${styles.modeBtn} ${correctionMode === 'smart' ? styles.modeBtnActive : ''}`}
                      onClick={() => setCorrectionMode('smart')}
                    >
                      ⚡ 智能模式
                      <span className={styles.modeHint}>本地预筛 + LLM 复验，省 token</span>
                    </button>
                    <button
                      className={`${styles.modeBtn} ${correctionMode === 'full' ? styles.modeBtnActive : ''}`}
                      onClick={() => setCorrectionMode('full')}
                    >
                      🔍 全量模式
                      <span className={styles.modeHint}>所有字幕送 LLM 分析</span>
                    </button>
                  </div>
                  <textarea
                    className={styles.originalDocInput}
                    placeholder="在此粘贴原始文稿/脚本..."
                    value={originalDoc}
                    onChange={(e) => setOriginalDoc(e.target.value)}
                    rows={4}
                  />
                  <div className={styles.correctionSectionActions}>
                    <Button
                      variant="primary"
                      loading={correcting}
                      disabled={correcting || !originalDoc.trim()}
                      onClick={handleCorrect}
                    >
                      {correcting ? '校准中...' : '开始校准'}
                    </Button>
                    {suggestions.length > 0 && (
                      <span className={styles.correctionResultHint}>
                        发现 {suggestions.length} 处可能的识别错误
                      </span>
                    )}
                    {suggestions.length === 0 && correctionModel && !correcting && (
                      <span className={styles.correctionOkHint}>✓ 未发现识别错误</span>
                    )}
                  </div>
                </div>

                {/* LLM 校准结果 — 左右对比面板 */}
                {suggestions.length > 0 && (
                  <div className={styles.corrPanel}>
                    <div className={styles.corrToolbar}>
                      <div className={styles.corrToolbarLeft}>
                        <span className={styles.corrBadge}>{suggestions.length}</span>
                        <span className={styles.corrToolbarTitle}>处识别错误</span>
                        {correctionModel && <span className={styles.corrModelTag}>{correctionModel}</span>}
                      </div>
                      <div className={styles.corrToolbarRight}>
                        <button className={styles.corrLinkBtn} onClick={() => {
                          if (acceptedSuggestions.size === suggestions.length) setAcceptedSuggestions(new Set());
                          else setAcceptedSuggestions(new Set(suggestions.map(s => s.index)));
                        }}>
                          {acceptedSuggestions.size === suggestions.length ? '取消全选' : '全选'}
                        </button>
                        <button
                          className={styles.corrApplyBtn}
                          disabled={acceptedSuggestions.size === 0}
                          onClick={applyCorrections}
                        >
                          应用修改 {acceptedSuggestions.size > 0 && `(${acceptedSuggestions.size})`}
                        </button>
                      </div>
                    </div>

                    <div className={styles.corrTable}>
                      <div className={styles.corrTableHeader}>
                        <div className={styles.corrColCheck}></div>
                        <div className={styles.corrColIdx}>#</div>
                        <div className={styles.corrColLeft}>识别文本</div>
                        <div className={styles.corrColRight}>校准文本</div>
                        <div className={styles.corrColReason}>说明</div>
                      </div>
                      {suggestions.map((s, i) => {
                        const accepted = acceptedSuggestions.has(s.index);
                        // 计算字符级 diff
                        const diffResult = computeCharDiff(s.original, s.suggested);
                        return (
                          <div
                            key={`${s.index}-${i}`}
                            className={`${styles.corrRow} ${accepted ? styles.corrRowActive : ''}`}
                            onClick={() => toggleAcceptSuggestion(s.index)}
                          >
                            <div className={styles.corrColCheck}>
                              <div className={`${styles.corrCheck} ${accepted ? styles.corrCheckOn : ''}`}>
                                {accepted && '✓'}
                              </div>
                            </div>
                            <div className={styles.corrColIdx}>{s.index}</div>
                            <div className={styles.corrColLeft}>
                              {diffResult.left.map((part, j) =>
                                part.changed
                                  ? <del key={j} className={styles.corrDel}>{part.text}</del>
                                  : <span key={j}>{part.text}</span>
                              )}
                            </div>
                            <div className={styles.corrColRight}>
                              {diffResult.right.map((part, j) =>
                                part.changed
                                  ? <ins key={j} className={styles.corrIns}>{part.text}</ins>
                                  : <span key={j}>{part.text}</span>
                              )}
                            </div>
                            <div className={styles.corrColReason}>
                              <span className={`${styles.corrConf} ${
                                s.confidence === 'high' ? styles.corrConfHigh :
                                s.confidence === 'medium' ? styles.corrConfMed : styles.corrConfLow
                              }`}>{s.confidence === 'high' ? '高' : s.confidence === 'medium' ? '中' : '低'}</span>
                              {s.reason}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* 双语字幕面板 */}
                {bilingualSegments.length > 0 && (
                  <div className={styles.bilingualPanel}>
                    <div className={styles.suggestionsHeader}>
                      <h3>🌐 双语字幕 ({targetLang})</h3>
                      <Button variant="primary" onClick={handleDownloadBilingual}>
                        下载双语 SRT
                      </Button>
                    </div>
                    <div className={styles.bilingualList}>
                      {bilingualSegments.map((seg) => (
                        <div key={seg.index} className={styles.bilingualItem}>
                          <div className={styles.bilingualIndex}>{seg.index}</div>
                          <div className={styles.bilingualTime}>{seg.time_line}</div>
                          <div className={styles.bilingualOriginal}>{seg.original}</div>
                          <div className={styles.bilingualTranslated}>{seg.translated}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
            {!result && !processing && !error && (
              <div style={{ color: 'var(--color-text-secondary)', textAlign: 'center', padding: 'var(--spacing-2xl)' }}>
                上传音频并点击识别，结果将显示在这里
              </div>
            )}
          </div>
        </div>
      </div>

      <div className={styles.historySection} ref={multiAudioRef}>
        <MultiAudioSelector onTranscribe={handleMultiTranscribe} processing={processing} />
        <TranscriptionHistory records={history} onDelete={handleDeleteRecord} />
      </div>
    </div>
  );
}
