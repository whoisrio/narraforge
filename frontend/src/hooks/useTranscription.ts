import { useState, useRef, useCallback, useEffect } from 'react';
import { speechToTextApi, subtitleLlmApi } from '../services/api';
import type { TranscribeResult, TranscriptionRecord, CorrectionSuggestion, BilingualSegment } from '../services/api';
import { saveSTTResult, getSTTHistory, deleteSTTResult } from '../services/indexedDB';
import { useStorageMode } from './useStorageMode';

function getErrorDetail(error: unknown, fallback: string): string {
  if (typeof error === 'object' && error !== null && 'response' in error) {
    const response = (error as { response?: { data?: { detail?: string } } }).response;
    return response?.data?.detail || fallback;
  }
  return fallback;
}

export function computeCharDiff(original: string, suggested: string) {
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

const ENGINE_OPTIONS = [
  { value: 'whisper', labelKey: 'transcription.engineWhisper' },
  { value: 'funasr', labelKey: 'transcription.engineFunASR' },
];

const WHISPER_MODEL_OPTIONS = [
  { value: 'tiny', labelKey: 'transcription.modelTiny' },
  { value: 'base', labelKey: 'transcription.modelBase' },
  { value: 'small', labelKey: 'transcription.modelSmall' },
  { value: 'medium', labelKey: 'transcription.modelMedium' },
  { value: 'large-v3', labelKey: 'transcription.modelLargeV3' },
];

const FUNASR_MODEL_OPTIONS = [
  { value: 'paraformer-zh', labelKey: 'transcription.modelParaformer' },
  { value: 'paraformer-zh-streaming', labelKey: 'transcription.modelParaformerStreaming' },
];

export { ENGINE_OPTIONS, WHISPER_MODEL_OPTIONS, FUNASR_MODEL_OPTIONS };

export function useTranscription() {
  const { mode: storageMode } = useStorageMode();

  // File state — array to support multi-file queue
  const [files, setFiles] = useState<File[]>([]);

  // Engine config
  const [engine, setEngine] = useState('whisper');
  const [modelSize, setModelSize] = useState('large-v3');
  const [beamSize, setBeamSize] = useState(5);
  const [enableVad, setEnableVad] = useState(true);

  // Transcription state
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<TranscribeResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // History
  const [history, setHistory] = useState<TranscriptionRecord[]>([]);

  // LLM correction state
  const [originalDoc, setOriginalDoc] = useState('');
  const [correctionMode, setCorrectionMode] = useState<'smart' | 'full'>('smart');
  const [suggestions, setSuggestions] = useState<CorrectionSuggestion[]>([]);
  const [correcting, setCorrecting] = useState(false);
  const [correctionModel, setCorrectionModel] = useState<string | null>(null);
  const [acceptedSuggestions, setAcceptedSuggestions] = useState<Set<number>>(new Set());

  // Bilingual subtitle state
  const [bilingualSegments, setBilingualSegments] = useState<BilingualSegment[]>([]);
  const [bilingualSrt, setBilingualSrt] = useState('');
  const [translating, setTranslating] = useState(false);
  const [targetLang, setTargetLang] = useState('English');

  // Refs
  const storageModeRef = useRef(storageMode);
  storageModeRef.current = storageMode;
  const blobUrlsRef = useRef<string[]>([]);

  const revokeBlobUrls = useCallback(() => {
    blobUrlsRef.current.forEach(url => URL.revokeObjectURL(url));
    blobUrlsRef.current = [];
  }, []);

  // ---- File management ----

  const replaceFiles = useCallback((newFiles: File[]) => {
    setFiles(newFiles);
    setResult(null);
    setError(null);
    setSuggestions([]);
    setAcceptedSuggestions(new Set());
    setBilingualSegments([]);
    setBilingualSrt('');
  }, []);

  const addFiles = useCallback((newFiles: File[]) => {
    setFiles(prev => [...prev, ...newFiles]);
  }, []);

  const removeFile = useCallback((index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  }, []);

  const moveFile = useCallback((index: number, direction: -1 | 1) => {
    setFiles(prev => {
      const target = index + direction;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }, []);

  // Audio URL for preview (first file)
  const audioUrl = files.length > 0 ? URL.createObjectURL(files[0]) : null;

  // ---- Engine config ----

  const handleEngineChange = useCallback((newEngine: string) => {
    setEngine(newEngine);
    if (newEngine === 'whisper') setModelSize('large-v3');
    else setModelSize('paraformer-zh');
  }, []);

  // ---- Transcription ----

  const handleTranscribe = useCallback(async () => {
    if (files.length === 0) return;
    setProcessing(true);
    setError(null);
    try {
      let res: TranscribeResult;
      if (files.length === 1) {
        res = await speechToTextApi.transcribe(files[0], modelSize, beamSize, engine, enableVad);
      } else {
        res = await speechToTextApi.multiTranscribe(files, modelSize, beamSize, engine, enableVad);
      }
      setResult(res);

      if (storageMode === 'frontend') {
        await saveSTTResult({
          id: res.file_id,
          original_filename: files.length === 1 ? files[0].name : 'merged_audio.mp3',
          audioBlob: files[0],
          srtContent: res.content,
          language: res.language,
          language_probability: res.language_probability,
          model_size: modelSize,
          created_at: new Date().toISOString(),
        });
      }

      loadHistory();
    } catch (err: unknown) {
      setError(getErrorDetail(err, 'transcription.errorTranscriptionFailed'));
    } finally {
      setProcessing(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, modelSize, beamSize, engine, enableVad, storageMode]);

  // ---- Export ----

  const handleDownload = useCallback(() => {
    if (!result) return;
    const stem = (files[0]?.name || result.filename || 'subtitle').replace(/\.[^.]+$/, '');
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
  }, [result, files]);

  const exportSubtitle = useCallback((format: 'json' | 'txt') => {
    if (!result) return;
    const stem = (files[0]?.name || result.filename || 'subtitle').replace(/\.[^.]+$/, '');
    const payload = format === 'json'
      ? JSON.stringify({
          file_id: result.file_id,
          filename: result.filename,
          language: result.language,
          language_probability: result.language_probability,
          content: result.content,
        }, null, 2)
      : result.content.replace(/\d+\n(\d\d:\d\d:\d\d,\d{3} --> \d\d:\d\d:\d\d,\d{3}\n)?/g, '').trim();
    const blob = new Blob([payload], { type: format === 'json' ? 'application/json;charset=utf-8' : 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${stem}.${format}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [result, files]);

  // ---- History ----

  const loadHistory = useCallback(async () => {
    const modeAtStart = storageModeRef.current;
    try {
      if (modeAtStart === 'frontend') {
        const localRecords = await getSTTHistory();
        if (storageModeRef.current !== modeAtStart) return;
        revokeBlobUrls();
        const mapped: TranscriptionRecord[] = localRecords.map((r) => {
          const aUrl = r.audioBlob ? URL.createObjectURL(r.audioBlob) : '';
          if (aUrl) blobUrlsRef.current.push(aUrl);
          const srtBlob = new Blob([r.srtContent || ''], { type: 'text/plain;charset=utf-8' });
          const srtUrl = URL.createObjectURL(srtBlob);
          blobUrlsRef.current.push(srtUrl);
          return {
            id: r.id,
            original_filename: r.original_filename,
            audio_url: aUrl,
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
    } catch (err) {
      console.error('Failed to load history:', err);
    }
  }, [revokeBlobUrls]);

  useEffect(() => { loadHistory(); }, [storageMode, loadHistory]);

  useEffect(() => {
    return () => { revokeBlobUrls(); };
  }, [revokeBlobUrls]);

  const handleDeleteRecord = useCallback(async (id: string) => {
    try {
      if (storageMode === 'frontend') {
        await deleteSTTResult(id);
      } else {
        await speechToTextApi.deleteRecord(id);
      }
      setHistory(prev => prev.filter(r => r.id !== id));
    } catch (err) {
      console.error('Failed to delete record:', err);
    }
  }, [storageMode]);

  // ---- LLM Correction ----

  const handleCorrect = useCallback(async () => {
    if (!result?.content) return;
    if (!originalDoc.trim()) {
      setError('transcription.errorNoOriginal');
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
    } catch (err: unknown) {
      setError(getErrorDetail(err, 'transcription.errorCorrectionFailed'));
    } finally {
      setCorrecting(false);
    }
  }, [result, originalDoc, correctionMode]);

  const toggleAcceptSuggestion = useCallback((index: number) => {
    setAcceptedSuggestions(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  const applyCorrections = useCallback(() => {
    if (!result || acceptedSuggestions.size === 0) return;
    let content = result.content;
    const sorted = [...suggestions]
      .filter(s => acceptedSuggestions.has(s.index))
      .sort((a, b) => {
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
  }, [result, suggestions, acceptedSuggestions]);

  // ---- Bilingual ----

  const handleTranslate = useCallback(async () => {
    if (!result?.content) return;
    setTranslating(true);
    setError(null);
    try {
      const res = await subtitleLlmApi.translate(result.content, targetLang);
      setBilingualSegments(res.segments);
      setBilingualSrt(res.bilingual_srt);
    } catch (err: unknown) {
      setError(getErrorDetail(err, 'transcription.errorTranslationFailed'));
    } finally {
      setTranslating(false);
    }
  }, [result, targetLang]);

  const handleDownloadBilingual = useCallback(() => {
    if (!bilingualSrt) return;
    const stem = (files[0]?.name || 'subtitle').replace(/\.[^.]+$/, '');
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
  }, [bilingualSrt, files]);

  return {
    // Files
    files, replaceFiles, addFiles, removeFile, moveFile,
    // Engine
    engine, handleEngineChange, modelSize, setModelSize,
    beamSize, setBeamSize, enableVad, setEnableVad,
    // Transcription
    processing, result, setResult, error, setError, handleTranscribe,
    // Export
    handleDownload, exportSubtitle,
    // History
    history, handleDeleteRecord,
    // Correction
    originalDoc, setOriginalDoc, correctionMode, setCorrectionMode,
    suggestions, acceptedSuggestions, correcting, correctionModel,
    handleCorrect, toggleAcceptSuggestion, applyCorrections,
    // Bilingual
    bilingualSegments, bilingualSrt, translating, targetLang, setTargetLang,
    handleTranslate, handleDownloadBilingual,
    // Audio preview
    audioUrl,
    // Options
    engineOptions: ENGINE_OPTIONS,
    whisperModelOptions: WHISPER_MODEL_OPTIONS,
    funasrModelOptions: FUNASR_MODEL_OPTIONS,
  };
}
