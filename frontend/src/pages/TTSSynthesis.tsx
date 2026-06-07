import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { GlobalControlBar } from '../components/TTSSynthesis/GlobalControlBar';
import { AudioPlayer } from '../components/TTSSynthesis/AudioPlayer';
import { SynthesisHistory } from '../components/TTSSynthesis/SynthesisHistory';
import { EdgeTTSPanel } from '../components/TTSSynthesis/EdgeTTSPanel';
import { MiMoTTSPanel, type MiMoMode } from '../components/TTSSynthesis/MiMoTTSPanel';
import { SSMLToolbar } from '../components/TTSSynthesis/SSMLToolbar';
import { TextInputPanel } from '../components/SegmentedTTS/TextInputPanel';
import { SegmentList } from '../components/SegmentedTTS/SegmentList';
import { ExportDialog } from '../components/SegmentedTTS/ExportDialog';
import { segmentedReducer, createInitialProject, type Action } from '../hooks/useSegmentedProject';
import { textSplitApi, ttsApi, mimoTtsApi } from '../services/api';
import { saveTTSResult, getTTSHistory, deleteTTSResult, getTTSAudioBlob } from '../services/indexedDB';
import { saveProject, getProject, listProjects } from '../services/segmentedProjectDB';
import { useStorageMode } from '../hooks/useStorageMode';
import { useVoiceRefresh } from '../hooks/useVoiceRefresh';
import type { TTSRequest, TTSResult, TTSResultRecord, VoiceProfile, SegmentedProject, SegmentEngineParams } from '../types';
import styles from './TTSSynthesis.module.css';

type Engine = 'cosyvoice' | 'edge_tts' | 'mimo_tts';
type Mode = 'single' | 'segmented';

function toEdgeFormat(value: number) {
  return value >= 0 ? `+${value}%` : `${value}%`;
}

export function TTSSynthesis() {
  const { mode: storageMode } = useStorageMode();
  const { refreshCounter } = useVoiceRefresh();
  const [mode, setMode] = useState<Mode>('single');
  const [engine, setEngine] = useState<Engine>('edge_tts');
  const [text, setText] = useState('');
  const [selectedVoiceId, setSelectedVoiceId] = useState<string>('');
  const [params, setParams] = useState<Partial<TTSRequest>>({ language: 'Chinese', speed: 1.0, volume: 80, pitch: 1.0 });

  // Edge-TTS state
  const [edgeVoice, setEdgeVoice] = useState('');
  const [edgeRate, setEdgeRate] = useState(0);
  const [edgeVolume, setEdgeVolume] = useState(0);

  // MiMo TTS state
  const [mimoMode, setMimoMode] = useState<MiMoMode>('preset');
  const [mimoPresetVoice, setMimoPresetVoice] = useState('冰糖');
  const [mimoInstruction, setMimoInstruction] = useState('');
  const [mimoCloneVoiceId, setMimoCloneVoiceId] = useState('');

  const [result, setResult] = useState<TTSResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [history, setHistory] = useState<TTSResultRecord[]>([]);
  const [voices, setVoices] = useState<VoiceProfile[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Segmented mode state
  const [project, setProject] = useState<SegmentedProject>(createInitialProject);
  const [projectList, setProjectList] = useState<SegmentedProject[]>([]);
  const [exportOpen, setExportOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'error' | 'success' } | null>(null);
  const [playingId, setPlayingId] = useState<string | undefined>();

  // Load last project from IndexedDB on mount
  useEffect(() => {
    listProjects().then(list => {
      setProjectList(list);
      if (list.length > 0) {
        const last = list[0];
        setProject(last);
        // Restore voice/params from project
        if (last.segments.length > 0) {
          const firstSeg = last.segments[0];
          if (firstSeg.params.engine) setEngine(firstSeg.params.engine as Engine);
        }
      }
    }).catch(() => {});
  }, []);

  // Auto-save project to IndexedDB (debounced)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (project.segments.length === 0 && project.name === '新项目') return; // skip empty default
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      try {
        await saveProject(project);
        // Refresh project list
        const list = await listProjects();
        setProjectList(list);
      } catch (e) { console.warn('Auto-save failed:', e); }
    }, 1000);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [project]);

  const dispatch = useCallback((action: Action) => {
    setProject(prev => segmentedReducer({ project: prev }, action).project);
  }, []);

  const showToast = useCallback((message: string, type: 'error' | 'success' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const voiceDescriptionMap = useMemo(() => {
    const map = new Map<string, string>();
    voices.forEach(v => { if (v.description && v.qwen_voice_id) map.set(v.qwen_voice_id, v.description); });
    return map;
  }, [voices]);

  useEffect(() => { ttsApi.getVoices().then(setVoices).catch(() => {}); }, [refreshCounter]);

  const storageModeRef = useRef(storageMode);
  storageModeRef.current = storageMode;
  const voiceDescriptionMapRef = useRef(voiceDescriptionMap);
  voiceDescriptionMapRef.current = voiceDescriptionMap;
  const enrichVoiceName = useCallback((voiceId: string, voiceName: string) => {
    return voiceDescriptionMapRef.current.get(voiceId) || voiceName;
  }, []);

  const blobUrlsRef = useRef<string[]>([]);
  const revokeBlobUrls = useCallback(() => {
    blobUrlsRef.current.forEach(url => URL.revokeObjectURL(url));
    blobUrlsRef.current = [];
  }, []);

  const loadHistory = useCallback(async () => {
    const modeAtStart = storageModeRef.current;
    try {
      if (modeAtStart === 'frontend') {
        const localRecords = await getTTSHistory();
        if (storageModeRef.current !== modeAtStart) return;
        revokeBlobUrls();
        const mapped: TTSResultRecord[] = localRecords.map((r) => {
          const blobUrl = r.audioBlob ? URL.createObjectURL(r.audioBlob) : '';
          if (blobUrl) blobUrlsRef.current.push(blobUrl);
          return { id: r.id, text: r.text, voice_id: r.voice_id, voice_name: enrichVoiceName(r.voice_id, r.voice_name), audio_url: blobUrl, audio_format: r.audio_format, speed: r.speed, volume: r.volume, pitch: r.pitch, instruction: r.instruction, language: r.language, created_at: r.created_at };
        });
        setHistory(mapped);
      } else {
        const data = await ttsApi.getHistory();
        if (storageModeRef.current !== modeAtStart) return;
        setHistory(data.map(r => ({ ...r, voice_name: enrichVoiceName(r.voice_id, r.voice_name) })));
      }
    } catch (error) { console.error('Failed to load history:', error); }
  }, [enrichVoiceName, revokeBlobUrls]);

  useEffect(() => { loadHistory(); }, [storageMode, loadHistory]);
  useEffect(() => { return () => { revokeBlobUrls(); }; }, [revokeBlobUrls]);

  const saveFrontendResult = useCallback(async (resp: TTSResult, audioFormat: string, voiceName: string, voiceId: string, instructionText: string, language: string) => {
    if (storageMode !== 'frontend' || !resp.audio_base64) return;
    const byteStr = atob(resp.audio_base64);
    const byteNums = new Uint8Array(byteStr.length);
    for (let i = 0; i < byteStr.length; i++) byteNums[i] = byteStr.charCodeAt(i);
    const mimeType = audioFormat === 'mp3' ? 'audio/mpeg' : `audio/${audioFormat}`;
    await saveTTSResult({ id: resp.audio_id, text: resp.text, voice_id: voiceId || '', voice_name: voiceName || '', audioBlob: new Blob([byteNums], { type: mimeType }), audio_format: audioFormat, speed: resp.params?.speed ?? 1.0, volume: resp.params?.volume ?? 80, pitch: resp.params?.pitch ?? 1.0, instruction: instructionText, language, created_at: new Date().toISOString() });
  }, [storageMode]);

  const handleSynthesize = useCallback(async () => {
    if (!text.trim()) { alert('请输入要合成的文本'); return; }
    if (engine === 'cosyvoice' && !selectedVoiceId) { alert('请选择一个声音'); return; }
    if (engine === 'edge_tts' && !edgeVoice) { alert('请选择一个音色'); return; }
    if (engine === 'mimo_tts' && mimoMode === 'preset' && !mimoPresetVoice) { alert('请选择一个预置音色'); return; }
    if (engine === 'mimo_tts' && mimoMode === 'voiceclone' && !mimoCloneVoiceId) { alert('请选择一个声音用于复刻'); return; }

    try {
      setIsLoading(true); setResult(null);
      if (engine === 'mimo_tts') {
        let resp: TTSResult;
        if (mimoMode === 'preset') {
          resp = await mimoTtsApi.synthesizePreset({ text, voice: mimoPresetVoice, instruction: mimoInstruction, format: 'wav' });
          await saveFrontendResult(resp, 'wav', mimoPresetVoice, mimoPresetVoice, mimoInstruction, 'Chinese');
        } else {
          resp = await mimoTtsApi.synthesizeVoiceClone({ text, voice_id: mimoCloneVoiceId, instruction: mimoInstruction, format: 'wav' });
          const cloneVoice = voices.find(v => v.id === mimoCloneVoiceId);
          await saveFrontendResult(resp, 'wav', cloneVoice?.name || '音色复刻', mimoCloneVoiceId, mimoInstruction, 'Chinese');
        }
        setResult(resp);
      } else if (engine === 'edge_tts') {
        const resp = await ttsApi.synthesize({ text, engine: 'edge_tts', voice_id: '', edge_voice: edgeVoice, edge_rate: toEdgeFormat(edgeRate), edge_volume: toEdgeFormat(edgeVolume), format: 'mp3' });
        await saveFrontendResult(resp, 'mp3', edgeVoice, edgeVoice, '', 'Chinese');
        setResult(resp);
      } else {
        const resp = await ttsApi.synthesize({ text, voice_id: selectedVoiceId, language: params.language || 'Chinese', speed: params.speed ?? 1.0, volume: params.volume ?? 80, pitch: params.pitch ?? 1.0, instruction: params.instruction || '', enable_ssml: params.enable_ssml ?? false, enable_markdown_filter: params.enable_markdown_filter ?? false, format: 'mp3' });
        await saveFrontendResult(resp, resp.audio_format || 'mp3', resp.voice_name || selectedVoiceId, resp.voice_id || selectedVoiceId, resp.params?.instruction || '', resp.params?.language || 'Chinese');
        setResult(resp);
      }
      loadHistory();
    } catch (error) { console.error('TTS synthesis failed:', error); alert('生成语音失败，请重试'); }
    finally { setIsLoading(false); }
  }, [text, engine, selectedVoiceId, edgeVoice, edgeRate, edgeVolume, params, mimoMode, mimoPresetVoice, mimoInstruction, mimoCloneVoiceId, loadHistory, storageMode, voices, saveFrontendResult]);

  const handleDeleteResult = useCallback(async (id: string) => {
    try {
      if (storageMode === 'frontend') { await deleteTTSResult(id); } else { await ttsApi.deleteResult(id); }
      setHistory(prev => prev.filter(r => r.id !== id));
    } catch (error) { console.error('Failed to delete result:', error); alert('删除失败'); }
  }, [storageMode]);

  const handlePlayResult = useCallback(async (record: TTSResultRecord) => {
    if (storageMode === 'frontend') {
      const blob = await getTTSAudioBlob(record.id);
      if (blob) {
        const reader = new FileReader();
        reader.onload = () => {
          const base64 = (reader.result as string).split(',')[1];
          setResult({ audio_id: record.id, audio_base64: base64, audio_format: record.audio_format || 'mp3', text: record.text, params: { voice_id: record.voice_id, speed: record.speed, volume: record.volume, pitch: record.pitch, language: record.language, instruction: record.instruction } });
        };
        reader.readAsDataURL(blob);
      }
    } else {
      setResult({ audio_id: record.id, audio_url: record.audio_url, text: record.text, params: { voice_id: record.voice_id, speed: record.speed, volume: record.volume, pitch: record.pitch, language: record.language, instruction: record.instruction } });
    }
  }, [storageMode]);

  // ---- Segmented mode handlers ----

  /** Build SegmentEngineParams from current global state */
  const buildCurrentParams = useCallback((): SegmentEngineParams => {
    if (engine === 'edge_tts') {
      return { engine: 'edge_tts', edge_voice: edgeVoice, edge_rate: toEdgeFormat(edgeRate), edge_volume: toEdgeFormat(edgeVolume) };
    }
    if (engine === 'mimo_tts') {
      return { engine: 'mimo_tts', mimo_mode: mimoMode, mimo_preset_voice: mimoPresetVoice, mimo_clone_voice_id: mimoCloneVoiceId, mimo_instruction: mimoInstruction };
    }
    return {
      engine: 'cosyvoice', voice_id: selectedVoiceId,
      instruction: params.instruction || '', speed: params.speed ?? 1.0, volume: params.volume ?? 80,
      pitch: params.pitch ?? 1.0, language: params.language || 'Chinese',
      enable_ssml: params.enable_ssml ?? false, enable_markdown_filter: params.enable_markdown_filter ?? false,
    };
  }, [engine, selectedVoiceId, params, edgeVoice, edgeRate, edgeVolume, mimoMode, mimoPresetVoice, mimoCloneVoiceId, mimoInstruction]);

  const handleRegenerate = useCallback(async (id: string) => {
    const seg = project.segments.find(s => s.id === id);
    if (!seg) return;
    dispatch({ type: 'GENERATE_START', id });
    try {
      const sp = seg.params;
      const overrides = seg.overrides || [];
      const gp = buildCurrentParams();

      // Merge: use segment override if explicit, otherwise global
      const voiceId = overrides.includes('voice') ? sp.voice_id : (sp.voice_id || gp.voice_id);
      const speed = overrides.includes('speed') ? sp.speed : (sp.speed ?? (gp as any).speed ?? 1.0);
      const volume = overrides.includes('volume') ? sp.volume : (sp.volume ?? (gp as any).volume ?? 80);
      const pitch = overrides.includes('pitch') ? sp.pitch : (sp.pitch ?? (gp as any).pitch ?? 1.0);
      const instruction = overrides.includes('instruction') ? sp.instruction : (sp.instruction || (gp as any).instruction || '');
      const language = overrides.includes('language') ? sp.language : (sp.language || (gp as any).language || 'Chinese');

      const textToSend = (sp.enable_ssml && seg.ssml) ? seg.ssml : seg.text;
      let resp: TTSResult;

      if (sp.engine === 'edge_tts') {
        const ev = overrides.includes('voice') ? sp.edge_voice : (sp.edge_voice || (gp as any).edge_voice || '');
        resp = await ttsApi.synthesize({ text: textToSend, engine: 'edge_tts', voice_id: '', edge_voice: ev, edge_rate: sp.edge_rate ?? '+0%', edge_volume: sp.edge_volume ?? '+0%', format: 'mp3' });
      } else if (sp.engine === 'mimo_tts') {
        resp = sp.mimo_mode === 'preset'
          ? await mimoTtsApi.synthesizePreset({ text: textToSend, voice: sp.mimo_preset_voice ?? '', instruction: sp.mimo_instruction ?? '', format: 'wav' })
          : await mimoTtsApi.synthesizeVoiceClone({ text: textToSend, voice_id: sp.mimo_clone_voice_id ?? '', instruction: sp.mimo_instruction ?? '', format: 'wav' });
      } else {
        resp = await ttsApi.synthesize({ text: textToSend, voice_id: voiceId ?? '', language: (language ?? 'Chinese') as 'Chinese' | 'English' | 'Japanese' | 'Korean', speed: speed ?? 1.0, volume: volume ?? 80, pitch: pitch ?? 1.0, instruction: instruction ?? '', enable_ssml: sp.enable_ssml ?? false, enable_markdown_filter: sp.enable_markdown_filter ?? false, format: 'mp3' });
      }
      if (!resp.audio_base64) throw new Error('No audio returned');
      const bytes = atob(resp.audio_base64);
      const arr = new Uint8Array(bytes.length);
      for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
      const fmt = resp.audio_format || 'mp3';
      const blob = new Blob([arr], { type: fmt === 'mp3' ? 'audio/mpeg' : `audio/${fmt}` });
      const ac = new AudioContext();
      const ab = await ac.decodeAudioData(await blob.arrayBuffer());
      const duration = ab.duration;
      ac.close();
      const audioId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      await saveTTSResult({ id: audioId, text: seg.text, voice_id: voiceId ?? '', voice_name: '', audioBlob: blob, audio_format: fmt, speed: speed ?? 1, volume: volume ?? 80, pitch: pitch ?? 1, instruction: instruction ?? '', language: language ?? 'Chinese', created_at: new Date().toISOString(), source: 'segmented_tts' });
      if (seg.previous_audio_id) { try { await deleteTTSResult(seg.previous_audio_id); } catch {} }
      // Save the actual voice identifier used (engine-specific)
      const usedVoiceId = sp.engine === 'edge_tts' ? (overrides.includes('voice') ? sp.edge_voice : (sp.edge_voice || (gp as any).edge_voice || '')) : voiceId;
      dispatch({ type: 'GENERATE_SUCCESS', id, audio_id: audioId, duration_sec: duration, generated_voice_id: usedVoiceId });
      loadHistory(); // refresh history so generated audio appears in list
    } catch (e: any) {
      dispatch({ type: 'GENERATE_FAIL', id, error: e?.message ?? '生成失败' });
    }
  }, [project.segments, dispatch, buildCurrentParams]);

  const handleRegenerateAll = useCallback(async () => {
    if (generating) return;
    setGenerating(true);
    const toGenerate = project.segments.filter(s => s.status === 'idle' || s.status === 'failed');
    dispatch({ type: 'MARK_QUEUED', ids: toGenerate.map(s => s.id) });
    let i = 0;
    const next = async () => { while (i < toGenerate.length) { const seg = toGenerate[i++]; await handleRegenerate(seg.id); } };
    await Promise.all(Array.from({ length: 3 }, () => next()));
    setGenerating(false);
    showToast('生成完成');
  }, [generating, project.segments, dispatch, handleRegenerate, showToast]);

  const handleAnnotateSSML = useCallback(async (idsArg?: string[]) => {
    const ids = idsArg ?? project.segments.filter(s => s.params.engine === 'cosyvoice').map(s => s.id);
    const targetSegs = project.segments.filter(s => ids.includes(s.id));
    if (!targetSegs.length) return;
    try {
      const result = await textSplitApi.ssmlAnnotate(targetSegs.map(s => s.text));
      const updates = targetSegs.map((s, i) => ({ id: s.id, ssml: result.annotations[i]?.ssml ?? `<speak>${s.text}</speak>` }));
      dispatch({ type: 'BATCH_SET_SSML', updates, by_llm: true });
      for (const s of targetSegs) { dispatch({ type: 'UPDATE_PARAMS', id: s.id, params: { enable_ssml: true } }); }
      showToast(`已为 ${targetSegs.length} 段标注 SSML`);
    } catch { showToast('SSML 标注失败，请检查 LLM 配置', 'error'); }
  }, [project.segments, dispatch, showToast]);

  const handlePlaySegment = useCallback(async (id: string) => {
    const seg = project.segments.find(s => s.id === id);
    if (!seg?.current_audio_id) return;
    setPlayingId(id);
    try {
      const blob = await getTTSAudioBlob(seg.current_audio_id);
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.onended = () => { setPlayingId(undefined); URL.revokeObjectURL(url); };
      audio.onerror = () => { setPlayingId(undefined); URL.revokeObjectURL(url); };
      await audio.play();
    } catch { setPlayingId(undefined); }
  }, [project.segments]);

  const handlePlayAll = useCallback(async () => {
    const readySegs = project.segments.filter(s => s.status === 'ready' && s.current_audio_id);
    if (readySegs.length === 0) return;
    for (const seg of readySegs) {
      setPlayingId(seg.id);
      try {
        const blob = await getTTSAudioBlob(seg.current_audio_id!);
        if (!blob) continue;
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        await new Promise<void>((resolve) => {
          audio.onended = () => { URL.revokeObjectURL(url); resolve(); };
          audio.onerror = () => { URL.revokeObjectURL(url); resolve(); };
          audio.play().catch(() => resolve());
        });
      } catch { /* skip */ }
    }
    setPlayingId(undefined);
  }, [project.segments]);

  const selectedVoice = voices.find(v => (v.qwen_voice_id || v.id) === selectedVoiceId);

  const canSynthesize = engine === 'edge_tts'
    ? !!text.trim() && !!edgeVoice
    : engine === 'mimo_tts'
      ? !!text.trim() && ((mimoMode === 'preset' && !!mimoPresetVoice) || (mimoMode === 'voiceclone' && !!mimoCloneVoiceId))
      : !!text.trim() && !!selectedVoiceId;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1>文字转语音</h1>
        <p>使用克隆的声音或预置音色生成高质量语音</p>
      </div>

      {/* PRIMARY: Mode Switch (high hierarchy) */}
      <div className={styles.modeSwitch}>
        <button className={`${styles.modeOption} ${mode === 'single' ? styles.active : ''}`} onClick={() => setMode('single')}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 8h8M8 12h6"/></svg>
          <div><div>单段合成</div><div className={styles.modeDesc}>输入文本快速生成</div></div>
        </button>
        <button className={`${styles.modeOption} ${mode === 'segmented' ? styles.active : ''}`} onClick={() => setMode('segmented')}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/></svg>
          <div><div>分段编辑</div><div className={styles.modeDesc}>时间轴编辑器</div></div>
        </button>
      </div>

      {/* SECONDARY: Engine Switch */}
      <div className={styles.engineSwitch}>
        <button className={`${styles.engineOption} ${engine === 'edge_tts' ? styles.active : ''}`} onClick={() => setEngine('edge_tts')}>Edge-TTS</button>
        <button className={`${styles.engineOption} ${engine === 'cosyvoice' ? styles.active : ''}`} onClick={() => setEngine('cosyvoice')}>CosyVoice</button>
        <button className={`${styles.engineOption} ${engine === 'mimo_tts' ? styles.active : ''}`} onClick={() => setEngine('mimo_tts')}>MiMo-TTS</button>
      </div>

      {/* ====== SINGLE MODE ====== */}
      {mode === 'single' && (
        <div className={styles.singleContent}>
          {/* Control Bar ABOVE text */}
          {engine === 'cosyvoice' ? (
            <GlobalControlBar
              selectedVoiceId={selectedVoiceId} onVoiceSelect={setSelectedVoiceId}
              speed={params.speed ?? 1.0} volume={params.volume ?? 80} pitch={params.pitch ?? 1.0} language={params.language || 'Chinese'}
              onSpeedChange={v => setParams(p => ({ ...p, speed: v }))}
              onVolumeChange={v => setParams(p => ({ ...p, volume: v }))}
              onPitchChange={v => setParams(p => ({ ...p, pitch: v }))}
              onLanguageChange={v => setParams(p => ({ ...p, language: v as any }))}
            />
          ) : engine === 'edge_tts' ? (
            <EdgeTTSPanel selectedVoice={edgeVoice} onVoiceSelect={setEdgeVoice} rate={edgeRate} volume={edgeVolume} onRateChange={setEdgeRate} onVolumeChange={setEdgeVolume} />
          ) : (
            <MiMoTTSPanel mode={mimoMode} onModeChange={setMimoMode} onPresetVoiceSelect={setMimoPresetVoice} selectedPresetVoice={mimoPresetVoice} onInstructionChange={setMimoInstruction} instruction={mimoInstruction} onCloneVoiceSelect={setMimoCloneVoiceId} selectedCloneVoiceId={mimoCloneVoiceId} />
          )}

          {/* Text Input */}
          <div className={styles.textSection}>
            <textarea ref={textareaRef} className={styles.textarea} placeholder="输入要合成的文字..." value={text} onChange={(e) => setText(e.target.value)} rows={6} />
            {engine === 'cosyvoice' && params.enable_ssml && (
              <SSMLToolbar text={text} onTextChange={setText} textareaRef={textareaRef} enabled={!!params.enable_ssml} />
            )}
            <div className={styles.textInfo}>
              <span>{text.length} 字符</span>
              <button onClick={() => setText('')} disabled={!text} className={styles.clearButton}>清空</button>
            </div>
          </div>

          {/* Generate */}
          <div className={styles.generateSection}>
            <button onClick={handleSynthesize} disabled={isLoading || !canSynthesize} className={styles.generateButton}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polygon points="5 3 19 12 5 21 5 3"/></svg>
              {isLoading ? '生成中...' : '生成语音'}
            </button>
          </div>

          <AudioPlayer result={result} isLoading={isLoading} />
          <SynthesisHistory results={history} onDelete={handleDeleteResult} onPlay={handlePlayResult} />
        </div>
      )}

      {/* ====== SEGMENTED MODE ====== */}
      {mode === 'segmented' && (
        <div className={styles.segmentedContent}>
          {/* Global Control Bar */}
          {engine === 'cosyvoice' ? (
            <GlobalControlBar
              selectedVoiceId={selectedVoiceId} onVoiceSelect={setSelectedVoiceId}
              speed={params.speed ?? 1.0} volume={params.volume ?? 80} pitch={params.pitch ?? 1.0} language={params.language || 'Chinese'}
              onSpeedChange={v => setParams(p => ({ ...p, speed: v }))}
              onVolumeChange={v => setParams(p => ({ ...p, volume: v }))}
              onPitchChange={v => setParams(p => ({ ...p, pitch: v }))}
              onLanguageChange={v => setParams(p => ({ ...p, language: v as any }))}
            />
          ) : engine === 'edge_tts' ? (
            <EdgeTTSPanel selectedVoice={edgeVoice} onVoiceSelect={setEdgeVoice} rate={edgeRate} volume={edgeVolume} onRateChange={setEdgeRate} onVolumeChange={setEdgeVolume} />
          ) : (
            <MiMoTTSPanel mode={mimoMode} onModeChange={setMimoMode} onPresetVoiceSelect={setMimoPresetVoice} selectedPresetVoice={mimoPresetVoice} onInstructionChange={setMimoInstruction} instruction={mimoInstruction} onCloneVoiceSelect={setMimoCloneVoiceId} selectedCloneVoiceId={mimoCloneVoiceId} />
          )}

          {/* Segmented Editor */}
          <div className={styles.segmentedEditor}>
            <div className={styles.segmentedToolbar}>
              {/* Project management */}
              <select
                className={styles.projectSelect}
                value={project.id}
                onChange={(e) => {
                  const pid = e.target.value;
                  if (pid === '__new__') {
                    const np = createInitialProject();
                    setProject(np);
                    dispatch({ type: 'LOAD_PROJECT', project: np });
                  } else {
                    const p = projectList.find(x => x.id === pid);
                    if (p) { setProject(p); dispatch({ type: 'LOAD_PROJECT', project: p }); }
                  }
                }}
              >
                {projectList.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.segments.length}段)
                  </option>
                ))}
                <option value="__new__">+ 新建项目</option>
              </select>
              <input className={styles.segmentedNameInput} value={project.name} onChange={(e) => dispatch({ type: 'RENAME_PROJECT', name: e.target.value })} />
              <span className={styles.segmentedStats}>
                {project.segments.length} 段 · {project.segments.reduce((a, s) => a + (s.duration_sec ?? 0), 0).toFixed(1)}s
                {project.segments.filter(s => s.status === 'ready').length > 0 && ` · ${project.segments.filter(s => s.status === 'ready').length}/${project.segments.length} 已生成`}
              </span>
              <div className={styles.segmentedActions}>
                <button className={styles.segmentedActionBtn} onClick={handleRegenerateAll} disabled={generating}>
                  {generating ? '生成中...' : '⚡ 全部生成'}
                </button>
                <button className={styles.segmentedActionBtn} onClick={handlePlayAll} disabled={!!playingId}>
                  {playingId ? '播放中...' : '▶ 全部播放'}
                </button>
                {engine === 'cosyvoice' && (
                  <button className={styles.segmentedActionBtn} onClick={() => handleAnnotateSSML()}>✨ 标注</button>
                )}
                <button className={styles.segmentedActionBtn} onClick={() => setExportOpen(true)}>⬇ 导出</button>
              </div>
            </div>

            <TextInputPanel
              splitConfig={project.split_config}
              onSplitConfigChange={(config) => dispatch({ type: 'SET_SPLIT_CONFIG', config })}
              onSplit={(texts) => {
                dispatch({ type: 'SET_DEFAULT_PARAMS', params: buildCurrentParams() });
                dispatch({ type: 'APPLY_SPLIT', items: texts.map(t => ({ text: t })) });
              }}
              onLLMSplit={async (text) => {
                dispatch({ type: 'SET_DEFAULT_PARAMS', params: buildCurrentParams() });
                const result = await textSplitApi.llmSplit(text, project.split_config.delimiters);
                dispatch({ type: 'APPLY_SPLIT', items: result.segments.map(s => ({ text: s.text, emotion: s.emotion })) });
              }}
            />

            <SegmentList
              segments={project.segments}
              layout={project.layout}
              selectedId={project.selected_segment_id}
              playingId={playingId}
              voices={voices}
              globalVoiceId={selectedVoiceId}
              globalVoiceName={selectedVoice?.description || selectedVoice?.name}
              globalEdgeVoice={edgeVoice}
              onSelect={(id) => { dispatch({ type: 'SELECT_SEGMENT', id }); }}
              onDelete={(id) => dispatch({ type: 'DELETE_SEGMENT', id })}
              onInsertAfter={(afterId) => dispatch({ type: 'INSERT_SEGMENT', afterId })}
              onAppend={() => dispatch({ type: 'APPEND_SEGMENT' })}
              onReorder={(from, to) => dispatch({ type: 'REORDER', fromIndex: from, toIndex: to })}
              onEdit={(id) => dispatch({ type: 'SELECT_SEGMENT', id })}
              onRegenerate={handleRegenerate}
              onPlay={handlePlaySegment}
              onUndo={(id) => dispatch({ type: 'UNDO_REGENERATE', id })}
              onDuplicate={(id) => {
                const seg = project.segments.find(s => s.id === id);
                if (seg) dispatch({ type: 'INSERT_SEGMENT', afterId: id, text: seg.text });
              }}
              onAnnotateSSML={(id) => handleAnnotateSSML([id])}
              onUpdateText={(id, text) => dispatch({ type: 'UPDATE_TEXT', id, text })}
              onUpdateSSML={(id, ssml) => dispatch({ type: 'UPDATE_SSML', id, ssml })}
              onUpdateParams={(id, params) => dispatch({ type: 'UPDATE_PARAMS', id, params })}
              onUpdateEmotion={(id, emotion) => dispatch({ type: 'UPDATE_EMOTION', id, emotion })}
            />

            {/* Audio History for segmented mode */}
            <SynthesisHistory results={history} onDelete={handleDeleteResult} onPlay={handlePlayResult} />

            <ExportDialog open={exportOpen} segments={project.segments} defaultName={project.name} onClose={() => setExportOpen(false)} />
          </div>
        </div>
      )}

      {toast && (
        <div className={`${styles.toast} ${toast.type === 'error' ? styles.toast_error : styles.toast_success}`}>
          {toast.message}
        </div>
      )}
    </div>
  );
}
