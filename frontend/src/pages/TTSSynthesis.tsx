import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { VoiceSelector } from '../components/TTSSynthesis/VoiceSelector';
import { ParameterControls } from '../components/TTSSynthesis/ParameterControls';
import { EdgeTTSParameterControls } from '../components/TTSSynthesis/EdgeTTSParameterControls';
import { AudioPlayer } from '../components/TTSSynthesis/AudioPlayer';
import { SynthesisHistory } from '../components/TTSSynthesis/SynthesisHistory';
import { EdgeTTSPanel } from '../components/TTSSynthesis/EdgeTTSPanel';
import { MiMoTTSPanel, type MiMoMode } from '../components/TTSSynthesis/MiMoTTSPanel';
import { SSMLToolbar } from '../components/TTSSynthesis/SSMLToolbar';
import { TextInputPanel } from '../components/SegmentedTTS/TextInputPanel';
import { SegmentList } from '../components/SegmentedTTS/SegmentList';
import { SegmentEditDrawer } from '../components/SegmentedTTS/SegmentEditDrawer';
import { ExportDialog } from '../components/SegmentedTTS/ExportDialog';
import { segmentedReducer, createInitialProject } from '../hooks/useSegmentedProject';
import { textSplitApi, ttsApi, mimoTtsApi } from '../services/api';
import { saveTTSResult, getTTSHistory, deleteTTSResult, getTTSAudioBlob } from '../services/indexedDB';
import { useStorageMode } from '../hooks/useStorageMode';
import { useVoiceRefresh } from '../hooks/useVoiceRefresh';
import type { TTSRequest, TTSResult, TTSResultRecord, VoiceProfile, SegmentedProject, SegmentEngineParams, Action } from '../types';
import styles from './TTSSynthesis.module.css';

type Engine = 'cosyvoice' | 'edge_tts' | 'mimo_tts';
type Mode = 'single' | 'segmented';

/** Edge-TTS 参数值转格式化字符串 */
function toEdgeFormat(value: number) {
  return value >= 0 ? `+${value}%` : `${value}%`;
}

/** 构建当前引擎/voice/params 对应的 SegmentEngineParams */
function buildSegmentEngineParams(
  engine: Engine,
  selectedVoiceId: string,
  params: Partial<TTSRequest>,
  edgeVoice: string, edgeRate: number, edgeVolume: number,
  mimoMode: MiMoMode, mimoPresetVoice: string, mimoCloneVoiceId: string, mimoInstruction: string,
): SegmentEngineParams {
  if (engine === 'edge_tts') {
    return {
      engine: 'edge_tts',
      edge_voice: edgeVoice,
      edge_rate: toEdgeFormat(edgeRate),
      edge_volume: toEdgeFormat(edgeVolume),
    };
  }
  if (engine === 'mimo_tts') {
    return {
      engine: 'mimo_tts',
      mimo_mode: mimoMode,
      mimo_preset_voice: mimoPresetVoice,
      mimo_clone_voice_id: mimoCloneVoiceId,
      mimo_instruction: mimoInstruction,
    };
  }
  return {
    engine: 'cosyvoice',
    voice_id: selectedVoiceId,
    instruction: params.instruction || '',
    speed: params.speed ?? 1.0,
    volume: params.volume ?? 80,
    pitch: params.pitch ?? 1.0,
    language: params.language || 'Chinese',
    enable_ssml: params.enable_ssml ?? false,
    enable_markdown_filter: params.enable_markdown_filter ?? false,
  };
}

export function TTSSynthesis() {
  const { mode: storageMode } = useStorageMode();
  const { refreshCounter } = useVoiceRefresh();
  const [mode, setMode] = useState<Mode>('single');
  const [engine, setEngine] = useState<Engine>('cosyvoice');
  const [text, setText] = useState('');
  const [selectedVoiceId, setSelectedVoiceId] = useState<string>('');
  const [params, setParams] = useState<Partial<TTSRequest>>({
    language: 'Chinese',
    speed: 1.0,
    volume: 80,
    pitch: 1.0,
  });

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
  const [exportOpen, setExportOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'error' | 'success' } | null>(null);

  const dispatch = useCallback((action: Action) => {
    setProject(prev => segmentedReducer({ project: prev }, action).project);
  }, []);

  const showToast = useCallback((message: string, type: 'error' | 'success' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  // 建立 voice_id → description 映射
  const voiceDescriptionMap = useMemo(() => {
    const map = new Map<string, string>();
    voices.forEach(v => {
      if (v.description && v.qwen_voice_id) {
        map.set(v.qwen_voice_id, v.description);
      }
    });
    return map;
  }, [voices]);

  useEffect(() => {
    ttsApi.getVoices().then(setVoices).catch(() => {});
  }, [refreshCounter]);

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
          return {
            id: r.id, text: r.text, voice_id: r.voice_id,
            voice_name: enrichVoiceName(r.voice_id, r.voice_name),
            audio_url: blobUrl, audio_format: r.audio_format,
            speed: r.speed, volume: r.volume, pitch: r.pitch,
            instruction: r.instruction, language: r.language, created_at: r.created_at,
          };
        });
        setHistory(mapped);
      } else {
        const data = await ttsApi.getHistory();
        if (storageModeRef.current !== modeAtStart) return;
        setHistory(data.map(r => ({ ...r, voice_name: enrichVoiceName(r.voice_id, r.voice_name) })));
      }
    } catch (error) {
      console.error('Failed to load history:', error);
    }
  }, [enrichVoiceName, revokeBlobUrls]);

  useEffect(() => { loadHistory(); }, [storageMode, loadHistory]);
  useEffect(() => { return () => { revokeBlobUrls(); }; }, [revokeBlobUrls]);

  const saveFrontendResult = useCallback(async (
    resp: TTSResult, audioFormat: string, voiceName: string,
    voiceId: string, instructionText: string, language: string,
  ) => {
    if (storageMode !== 'frontend' || !resp.audio_base64) return;
    const byteStr = atob(resp.audio_base64);
    const byteNums = new Uint8Array(byteStr.length);
    for (let i = 0; i < byteStr.length; i++) byteNums[i] = byteStr.charCodeAt(i);
    const mimeType = audioFormat === 'mp3' ? 'audio/mpeg' : `audio/${audioFormat}`;
    await saveTTSResult({
      id: resp.audio_id, text: resp.text, voice_id: voiceId || '',
      voice_name: voiceName || '', audioBlob: new Blob([byteNums], { type: mimeType }),
      audio_format: audioFormat, speed: resp.params?.speed ?? 1.0,
      volume: resp.params?.volume ?? 80, pitch: resp.params?.pitch ?? 1.0,
      instruction: instructionText, language, created_at: new Date().toISOString(),
    });
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
    } catch (error) {
      console.error('TTS synthesis failed:', error);
      alert('生成语音失败，请重试');
    } finally { setIsLoading(false); }
  }, [text, engine, selectedVoiceId, edgeVoice, edgeRate, edgeVolume, params, mimoMode, mimoPresetVoice, mimoInstruction, mimoCloneVoiceId, loadHistory, storageMode, voices, saveFrontendResult]);

  const handleDeleteResult = useCallback(async (id: string) => {
    try {
      if (storageMode === 'frontend') { await deleteTTSResult(id); }
      else { await ttsApi.deleteResult(id); }
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

  const currentSegmentParams = useMemo(() =>
    buildSegmentEngineParams(engine, selectedVoiceId, params, edgeVoice, edgeRate, edgeVolume, mimoMode, mimoPresetVoice, mimoCloneVoiceId, mimoInstruction),
    [engine, selectedVoiceId, params, edgeVoice, edgeRate, edgeVolume, mimoMode, mimoPresetVoice, mimoCloneVoiceId, mimoInstruction]
  );

  const handleRegenerate = useCallback(async (id: string) => {
    const seg = project.segments.find(s => s.id === id);
    if (!seg) return;
    dispatch({ type: 'GENERATE_START', id });
    try {
      const p = seg.params;
      const textToSend = (p.enable_ssml && seg.ssml) ? seg.ssml : seg.text;
      let resp: TTSResult;
      if (p.engine === 'edge_tts') {
        resp = await ttsApi.synthesize({ text: textToSend, engine: 'edge_tts', voice_id: '', edge_voice: p.edge_voice ?? '', edge_rate: p.edge_rate ?? '+0%', edge_volume: p.edge_volume ?? '+0%', format: 'mp3' });
      } else if (p.engine === 'mimo_tts') {
        resp = p.mimo_mode === 'preset'
          ? await mimoTtsApi.synthesizePreset({ text: textToSend, voice: p.mimo_preset_voice ?? '', instruction: p.mimo_instruction ?? '', format: 'wav' })
          : await mimoTtsApi.synthesizeVoiceClone({ text: textToSend, voice_id: p.mimo_clone_voice_id ?? '', instruction: p.mimo_instruction ?? '', format: 'wav' });
      } else {
        resp = await ttsApi.synthesize({ text: textToSend, voice_id: p.voice_id ?? '', language: p.language ?? 'Chinese', speed: p.speed ?? 1.0, volume: p.volume ?? 80, pitch: p.pitch ?? 1.0, instruction: p.instruction ?? '', enable_ssml: p.enable_ssml ?? false, enable_markdown_filter: p.enable_markdown_filter ?? false, format: 'mp3' });
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
      await saveTTSResult({ id: audioId, text: seg.text, voice_id: p.voice_id ?? '', voice_name: '', audioBlob: blob, audio_format: fmt, speed: p.speed ?? 1, volume: p.volume ?? 80, pitch: p.pitch ?? 1, instruction: p.instruction ?? '', language: p.language ?? 'Chinese', created_at: new Date().toISOString(), source: 'segmented_tts' });
      if (seg.previous_audio_id) { try { await deleteTTSResult(seg.previous_audio_id); } catch {} }
      dispatch({ type: 'GENERATE_SUCCESS', id, audio_id: audioId, duration_sec: duration });
    } catch (e: any) {
      dispatch({ type: 'GENERATE_FAIL', id, error: e?.message ?? '生成失败' });
    }
  }, [project.segments, dispatch]);

  const handleRegenerateAll = useCallback(async () => {
    if (generating) return;
    setGenerating(true);
    const toGenerate = project.segments.filter(s => s.status === 'idle' || s.status === 'failed');
    dispatch({ type: 'MARK_QUEUED', ids: toGenerate.map(s => s.id) });
    let i = 0;
    const next = async () => { while (i < toGenerate.length) { const seg = toGenerate[i++]; await handleRegenerate(seg.id); } };
    await Promise.all(Array.from({ length: 3 }, () => next()));
    setGenerating(false);
    showToast(`生成完成`);
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
    const blob = await getTTSAudioBlob(seg.current_audio_id);
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.play().finally(() => URL.revokeObjectURL(url));
  }, [project.segments]);

  const editingSegment = project.segments.find(s => s.id === project.selected_segment_id) ?? null;

  const canSynthesize = engine === 'edge_tts'
    ? !!text.trim() && !!edgeVoice
    : engine === 'mimo_tts'
      ? !!text.trim() && ((mimoMode === 'preset' && !!mimoPresetVoice) || (mimoMode === 'voiceclone' && !!mimoCloneVoiceId))
      : !!text.trim() && !!selectedVoiceId;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1>文字转语音</h1>
        <p>使用克隆的声音生成语音</p>
      </div>

      {/* Mode Switch */}
      <div className={styles.modeSwitch}>
        <button
          className={`${styles.modeOption} ${mode === 'single' ? styles.active : ''}`}
          onClick={() => setMode('single')}
        >
          单段合成
        </button>
        <button
          className={`${styles.modeOption} ${mode === 'segmented' ? styles.active : ''}`}
          onClick={() => setMode('segmented')}
        >
          分段编辑
        </button>
      </div>

      {/* Engine Selector */}
      <div className={styles.engineSwitch}>
        <button className={`${styles.engineOption} ${engine === 'cosyvoice' ? styles.active : ''}`} onClick={() => setEngine('cosyvoice')}>CosyVoice</button>
        <button className={`${styles.engineOption} ${engine === 'edge_tts' ? styles.active : ''}`} onClick={() => setEngine('edge_tts')}>Edge-TTS</button>
        <button className={`${styles.engineOption} ${engine === 'mimo_tts' ? styles.active : ''}`} onClick={() => setEngine('mimo_tts')}>MiMo-TTS</button>
      </div>

      {mode === 'single' ? (
        /* ========== 单段合成模式 ========== */
        <div className={styles.content}>
          <div className={styles.leftColumn}>
            <div className={styles.textSection}>
              <textarea ref={textareaRef} className={styles.textarea} placeholder="输入要合成的文字..." value={text} onChange={(e) => setText(e.target.value)} rows={8} />
              {engine === 'cosyvoice' && params.enable_ssml && (
                <SSMLToolbar text={text} onTextChange={setText} textareaRef={textareaRef} enabled={!!params.enable_ssml} />
              )}
              <div className={styles.textInfo}>
                <span>{text.length} 字符</span>
                <button onClick={() => setText('')} disabled={!text} className={styles.clearButton}>清空</button>
              </div>
            </div>
            {engine === 'cosyvoice' ? (
              <VoiceSelector selectedVoiceId={selectedVoiceId} onVoiceSelect={setSelectedVoiceId} />
            ) : engine === 'edge_tts' ? (
              <EdgeTTSPanel selectedVoice={edgeVoice} onVoiceSelect={setEdgeVoice} />
            ) : (
              <MiMoTTSPanel mode={mimoMode} onModeChange={setMimoMode} onPresetVoiceSelect={setMimoPresetVoice} selectedPresetVoice={mimoPresetVoice} onInstructionChange={setMimoInstruction} instruction={mimoInstruction} onCloneVoiceSelect={setMimoCloneVoiceId} selectedCloneVoiceId={mimoCloneVoiceId} />
            )}
          </div>
          <div className={styles.rightColumn}>
            {engine === 'cosyvoice' ? (
              <ParameterControls params={params} onParamChange={setParams} />
            ) : engine === 'edge_tts' ? (
              <EdgeTTSParameterControls rate={edgeRate} volume={edgeVolume} onRateChange={setEdgeRate} onVolumeChange={setEdgeVolume} />
            ) : null}
            <button onClick={handleSynthesize} disabled={isLoading || !canSynthesize} className={styles.generateButton}>
              {isLoading ? '生成中...' : '生成语音'}
            </button>
            <AudioPlayer result={result} isLoading={isLoading} />
            <SynthesisHistory results={history} onDelete={handleDeleteResult} onPlay={handlePlayResult} />
          </div>
        </div>
      ) : (
        /* ========== 分段编辑模式 ========== */
        <div className={styles.segmentedContent}>
          {/* Voice Selector + Params（共享引擎选择） */}
          <div className={styles.segmentedVoiceSection}>
            {engine === 'cosyvoice' ? (
              <VoiceSelector selectedVoiceId={selectedVoiceId} onVoiceSelect={setSelectedVoiceId} />
            ) : engine === 'edge_tts' ? (
              <EdgeTTSPanel selectedVoice={edgeVoice} onVoiceSelect={setEdgeVoice} />
            ) : (
              <MiMoTTSPanel mode={mimoMode} onModeChange={setMimoMode} onPresetVoiceSelect={setMimoPresetVoice} selectedPresetVoice={mimoPresetVoice} onInstructionChange={setMimoInstruction} instruction={mimoInstruction} onCloneVoiceSelect={setMimoCloneVoiceId} selectedCloneVoiceId={mimoCloneVoiceId} />
            )}
            {engine === 'cosyvoice' && (
              <ParameterControls params={params} onParamChange={setParams} />
            )}
            {engine === 'edge_tts' && (
              <EdgeTTSParameterControls rate={edgeRate} volume={edgeVolume} onRateChange={setEdgeRate} onVolumeChange={setEdgeVolume} />
            )}
          </div>

          {/* 分段编辑器 */}
          <div className={styles.segmentedEditor}>
            <div className={styles.segmentedToolbar}>
              <input className={styles.segmentedNameInput} value={project.name} onChange={(e) => dispatch({ type: 'RENAME_PROJECT', name: e.target.value })} />
              <span className={styles.segmentedStats}>
                {project.segments.length} 段 · {project.segments.reduce((a, s) => a + (s.duration_sec ?? 0), 0).toFixed(1)}s
                {project.segments.filter(s => s.status === 'ready').length > 0 && ` · ${project.segments.filter(s => s.status === 'ready').length}/${project.segments.length} 已生成`}
              </span>
              <div className={styles.segmentedActions}>
                <button className={styles.segmentedActionBtn} onClick={handleRegenerateAll} disabled={generating}>
                  {generating ? '生成中...' : '⚡ 全部生成'}
                </button>
                {engine === 'cosyvoice' && (
                  <button className={styles.segmentedActionBtn} onClick={() => handleAnnotateSSML()}>✨ 标注</button>
                )}
                <button className={styles.segmentedActionBtn} onClick={() => setExportOpen(true)}>⬇ 导出</button>
                <button className={styles.segmentedActionBtn} onClick={() => dispatch({ type: 'SET_LAYOUT', layout: project.layout === 'vertical' ? 'horizontal' : 'vertical' })}>
                  {project.layout === 'vertical' ? '⇄ 横向' : '⇅ 纵向'}
                </button>
              </div>
            </div>

            <TextInputPanel
              splitConfig={project.split_config}
              onSplitConfigChange={(config) => dispatch({ type: 'SET_SPLIT_CONFIG', config })}
              onSplit={(texts) => dispatch({ type: 'APPLY_SPLIT', texts })}
              onLLMSplit={async (text) => {
                const result = await textSplitApi.llmSplit(text, project.split_config.delimiters);
                dispatch({ type: 'APPLY_SPLIT', texts: result.segments.map(s => s.text) });
              }}
            />

            <SegmentList
              segments={project.segments}
              layout={project.layout}
              selectedId={project.selected_segment_id}
              onSelect={(id) => { dispatch({ type: 'SELECT_SEGMENT', id }); if (id) handlePlaySegment(id); }}
              onDelete={(id) => dispatch({ type: 'DELETE_SEGMENT', id })}
              onInsertAfter={(afterId) => dispatch({ type: 'INSERT_SEGMENT', afterId })}
              onAppend={() => dispatch({ type: 'APPEND_SEGMENT' })}
              onReorder={(from, to) => dispatch({ type: 'REORDER', fromIndex: from, toIndex: to })}
              onEdit={(id) => dispatch({ type: 'SELECT_SEGMENT', id })}
              onRegenerate={handleRegenerate}
              onUndo={(id) => dispatch({ type: 'UNDO_REGENERATE', id })}
              onDuplicate={(id) => {
                const seg = project.segments.find(s => s.id === id);
                if (seg) dispatch({ type: 'INSERT_SEGMENT', afterId: id, text: seg.text });
              }}
              onAnnotateSSML={(id) => handleAnnotateSSML([id])}
            />

            {project.layout === 'vertical' ? (
              <SegmentEditDrawer
                segment={editingSegment}
                onClose={() => dispatch({ type: 'SELECT_SEGMENT', id: undefined })}
                onUpdateText={(id, text) => dispatch({ type: 'UPDATE_TEXT', id, text })}
                onUpdateSSML={(id, ssml) => dispatch({ type: 'UPDATE_SSML', id, ssml })}
                onUpdateParams={(id, params) => dispatch({ type: 'UPDATE_PARAMS', id, params })}
                onRegenerate={handleRegenerate}
                onAnnotateSSML={(id) => handleAnnotateSSML([id])}
              />
            ) : (
              editingSegment && (
                <div className={styles.inlineEditor}>
                  <h4>编辑 #{editingSegment.id.slice(-3)}</h4>
                  <textarea
                    className={styles.inlineEditorTextarea}
                    value={editingSegment.text}
                    onChange={(e) => dispatch({ type: 'UPDATE_TEXT', id: editingSegment.id, text: e.target.value })}
                    rows={2}
                  />
                  <div className={styles.inlineEditorActions}>
                    <button className={styles.inlineEditorBtnPrimary} onClick={() => handleRegenerate(editingSegment.id)}>↻ 重新生成</button>
                    <button className={styles.inlineEditorBtnSecondary} onClick={() => dispatch({ type: 'SELECT_SEGMENT', id: undefined })}>关闭</button>
                  </div>
                </div>
              )
            )}
          </div>

          <ExportDialog open={exportOpen} segments={project.segments} defaultName={project.name} onClose={() => setExportOpen(false)} />
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
