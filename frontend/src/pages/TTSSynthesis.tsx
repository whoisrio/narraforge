import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { VoiceSelector } from '../components/TTSSynthesis/VoiceSelector';
import { ParameterControls } from '../components/TTSSynthesis/ParameterControls';
import { EdgeTTSParameterControls } from '../components/TTSSynthesis/EdgeTTSParameterControls';
import { AudioPlayer } from '../components/TTSSynthesis/AudioPlayer';
import { SynthesisHistory } from '../components/TTSSynthesis/SynthesisHistory';
import { EdgeTTSPanel } from '../components/TTSSynthesis/EdgeTTSPanel';
import { MiMoTTSPanel, type MiMoMode } from '../components/TTSSynthesis/MiMoTTSPanel';
import { SSMLToolbar } from '../components/TTSSynthesis/SSMLToolbar';
import { ttsApi, mimoTtsApi } from '../services/api';
import { saveTTSResult, getTTSHistory, deleteTTSResult, getTTSAudioBlob } from '../services/indexedDB';
import { useStorageMode } from '../hooks/useStorageMode';
import { useVoiceRefresh } from '../hooks/useVoiceRefresh';
import type { TTSRequest, TTSResult, TTSResultRecord, VoiceProfile } from '../types';
import styles from './TTSSynthesis.module.css';

type Engine = 'cosyvoice' | 'edge_tts' | 'mimo_tts';

/** Edge-TTS 参数值转格式化字符串 */
function toEdgeFormat(value: number) {
  return value >= 0 ? `+${value}%` : `${value}%`;
}

export function TTSSynthesis() {
  const { mode: storageMode } = useStorageMode();
  const { refreshCounter } = useVoiceRefresh();
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
  const [mimoVoiceDescription, setMimoVoiceDescription] = useState('');
  const [mimoSynthText, setMimoSynthText] = useState('');
  const [mimoInstruction, setMimoInstruction] = useState('');
  const [mimoCloneVoiceId, setMimoCloneVoiceId] = useState('');
  const [mimoOptimizeText, setMimoOptimizeText] = useState(true);

  const [result, setResult] = useState<TTSResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [history, setHistory] = useState<TTSResultRecord[]>([]);
  const [voices, setVoices] = useState<VoiceProfile[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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
            id: r.id,
            text: r.text,
            voice_id: r.voice_id,
            voice_name: enrichVoiceName(r.voice_id, r.voice_name),
            audio_url: blobUrl,
            audio_format: r.audio_format,
            speed: r.speed,
            volume: r.volume,
            pitch: r.pitch,
            instruction: r.instruction,
            language: r.language,
            created_at: r.created_at,
          };
        });
        setHistory(mapped);
      } else {
        const data = await ttsApi.getHistory();
        if (storageModeRef.current !== modeAtStart) return;
        const enriched = data.map(r => ({
          ...r,
          voice_name: enrichVoiceName(r.voice_id, r.voice_name),
        }));
        setHistory(enriched);
      }
    } catch (error) {
      console.error('Failed to load history:', error);
    }
  }, [enrichVoiceName, revokeBlobUrls]);

  useEffect(() => { loadHistory(); }, [storageMode, loadHistory]);

  useEffect(() => {
    return () => { revokeBlobUrls(); };
  }, [revokeBlobUrls]);

  /** 保存前端存储模式下的合成结果到 IndexedDB */
  const saveFrontendResult = useCallback(async (
    resp: TTSResult,
    audioFormat: string,
    voiceName: string,
    voiceId: string,
    instructionText: string,
    language: string,
  ) => {
    if (storageMode !== 'frontend' || !resp.audio_base64) return;
    const byteStr = atob(resp.audio_base64);
    const byteNums = new Uint8Array(byteStr.length);
    for (let i = 0; i < byteStr.length; i++) {
      byteNums[i] = byteStr.charCodeAt(i);
    }
    const mimeType = audioFormat === 'mp3' ? 'audio/mpeg' : `audio/${audioFormat}`;
    await saveTTSResult({
      id: resp.audio_id,
      text: resp.text,
      voice_id: voiceId || '',
      voice_name: voiceName || '',
      audioBlob: new Blob([byteNums], { type: mimeType }),
      audio_format: audioFormat,
      speed: resp.params?.speed ?? 1.0,
      volume: resp.params?.volume ?? 80,
      pitch: resp.params?.pitch ?? 1.0,
      instruction: instructionText,
      language: language,
      created_at: new Date().toISOString(),
    });
  }, [storageMode]);

  const handleSynthesize = useCallback(async () => {
    if (!text.trim()) {
      alert('请输入要合成的文本');
      return;
    }

    if (engine === 'cosyvoice' && !selectedVoiceId) {
      alert('请选择一个声音');
      return;
    }
    if (engine === 'edge_tts' && !edgeVoice) {
      alert('请选择一个音色');
      return;
    }
    if (engine === 'mimo_tts' && mimoMode === 'preset' && !mimoPresetVoice) {
      alert('请选择一个预置音色');
      return;
    }
    if (engine === 'mimo_tts' && mimoMode === 'voicedesign' && !mimoVoiceDescription.trim()) {
      alert('请填写音色描述');
      return;
    }
    if (engine === 'mimo_tts' && mimoMode === 'voiceclone' && !mimoCloneVoiceId) {
      alert('请选择一个声音用于复刻');
      return;
    }

    try {
      setIsLoading(true);
      setResult(null);

      if (engine === 'mimo_tts') {
        // ---------- MiMo TTS ----------
        let resp: TTSResult;
        if (mimoMode === 'preset') {
          resp = await mimoTtsApi.synthesizePreset({
            text,
            voice: mimoPresetVoice,
            instruction: mimoInstruction,
            format: 'wav',
          });
          await saveFrontendResult(resp, 'wav', mimoPresetVoice, mimoPresetVoice, mimoInstruction, 'Chinese');
        } else if (mimoMode === 'voicedesign') {
          resp = await mimoTtsApi.synthesizeVoiceDesign({
            text: mimoSynthText || undefined,
            voice_description: mimoVoiceDescription,
            optimize_text_preview: mimoOptimizeText,
            format: 'wav',
          });
          const label = mimoVoiceDescription.slice(0, 30) + (mimoVoiceDescription.length > 30 ? '...' : '');
          await saveFrontendResult(resp, 'wav', label, '', mimoVoiceDescription, 'Chinese');
        } else {
          // voiceclone
          resp = await mimoTtsApi.synthesizeVoiceClone({
            text,
            voice_id: mimoCloneVoiceId,
            instruction: mimoInstruction,
            format: 'wav',
          });
          const cloneVoice = voices.find(v => v.id === mimoCloneVoiceId);
          await saveFrontendResult(resp, 'wav', cloneVoice?.name || '音色复刻', mimoCloneVoiceId, mimoInstruction, 'Chinese');
        }
        setResult(resp);
      } else if (engine === 'edge_tts') {
        // ---------- Edge TTS ----------
        const resp = await ttsApi.synthesize({
          text,
          engine: 'edge_tts',
          voice_id: '',
          edge_voice: edgeVoice,
          edge_rate: toEdgeFormat(edgeRate),
          edge_volume: toEdgeFormat(edgeVolume),
          format: 'mp3',
        });
        await saveFrontendResult(resp, 'mp3', edgeVoice, edgeVoice, '', 'Chinese');
        setResult(resp);
      } else {
        // ---------- CosyVoice ----------
        const resp = await ttsApi.synthesize({
          text,
          voice_id: selectedVoiceId,
          language: params.language || 'Chinese',
          speed: params.speed ?? 1.0,
          volume: params.volume ?? 80,
          pitch: params.pitch ?? 1.0,
          instruction: params.instruction || '',
          enable_ssml: params.enable_ssml ?? false,
          enable_markdown_filter: params.enable_markdown_filter ?? false,
          format: 'mp3',
        });
        await saveFrontendResult(
          resp,
          resp.audio_format || 'mp3',
          resp.voice_name || selectedVoiceId,
          resp.voice_id || selectedVoiceId,
          resp.params?.instruction || '',
          resp.params?.language || 'Chinese',
        );
        setResult(resp);
      }

      loadHistory();
    } catch (error) {
      console.error('TTS synthesis failed:', error);
      alert('生成语音失败，请重试');
    } finally {
      setIsLoading(false);
    }
  }, [
    text, engine, selectedVoiceId, edgeVoice, edgeRate, edgeVolume, params,
    mimoMode, mimoPresetVoice, mimoVoiceDescription, mimoSynthText,
    mimoInstruction, mimoCloneVoiceId, mimoOptimizeText,
    loadHistory, storageMode, voices, saveFrontendResult,
  ]);

  const handleDeleteResult = useCallback(async (id: string) => {
    try {
      if (storageMode === 'frontend') {
        await deleteTTSResult(id);
      } else {
        await ttsApi.deleteResult(id);
      }
      setHistory(prev => prev.filter(r => r.id !== id));
    } catch (error) {
      console.error('Failed to delete result:', error);
      alert('删除失败');
    }
  }, [storageMode]);

  const handlePlayResult = useCallback(async (record: TTSResultRecord) => {
    if (storageMode === 'frontend') {
      const blob = await getTTSAudioBlob(record.id);
      if (blob) {
        const reader = new FileReader();
        reader.onload = () => {
          const base64 = (reader.result as string).split(',')[1];
          setResult({
            audio_id: record.id,
            audio_base64: base64,
            audio_format: record.audio_format || 'mp3',
            text: record.text,
            params: {
              voice_id: record.voice_id,
              speed: record.speed,
              volume: record.volume,
              pitch: record.pitch,
              language: record.language,
              instruction: record.instruction,
            },
          });
        };
        reader.readAsDataURL(blob);
      }
    } else {
      setResult({
        audio_id: record.id,
        audio_url: record.audio_url,
        text: record.text,
        params: {
          voice_id: record.voice_id,
          speed: record.speed,
          volume: record.volume,
          pitch: record.pitch,
          language: record.language,
          instruction: record.instruction,
        },
      });
    }
  }, [storageMode]);

  const canSynthesize = engine === 'edge_tts'
    ? text.trim() && edgeVoice
    : engine === 'mimo_tts'
      ? text.trim() && (
        (mimoMode === 'preset' && mimoPresetVoice) ||
        (mimoMode === 'voicedesign' && mimoVoiceDescription.trim()) ||
        (mimoMode === 'voiceclone' && mimoCloneVoiceId)
      )
      : text.trim() && selectedVoiceId;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1>文字转语音</h1>
        <p>使用克隆的声音生成语音</p>
      </div>

      {/* Engine Selector - 分段控制器 */}
      <div className={styles.engineSwitch}>
        <button
          className={`${styles.engineOption} ${engine === 'cosyvoice' ? styles.active : ''}`}
          onClick={() => setEngine('cosyvoice')}
        >
          CosyVoice
        </button>
        <button
          className={`${styles.engineOption} ${engine === 'edge_tts' ? styles.active : ''}`}
          onClick={() => setEngine('edge_tts')}
        >
          Edge-TTS
        </button>
        <button
          className={`${styles.engineOption} ${engine === 'mimo_tts' ? styles.active : ''}`}
          onClick={() => setEngine('mimo_tts')}
        >
          MiMo-TTS
        </button>
      </div>

      <div className={styles.content}>
        {/* Left Column: Input & Voice */}
        <div className={styles.leftColumn}>
          {/* Text Input */}
          <div className={styles.textSection}>
            <textarea
              ref={textareaRef}
              className={styles.textarea}
              placeholder="输入要合成的文字..."
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={8}
            />
            {/* SSML 工具栏 - 仅 CosyVoice 引擎且开启 SSML 时显示 */}
            {engine === 'cosyvoice' && params.enable_ssml && (
              <SSMLToolbar
                text={text}
                onTextChange={setText}
                textareaRef={textareaRef}
                enabled={!!params.enable_ssml}
              />
            )}
            <div className={styles.textInfo}>
              <span>{text.length} 字符</span>
              <button
                onClick={() => setText('')}
                disabled={!text}
                className={styles.clearButton}
              >
                清空
              </button>
            </div>
          </div>

          {/* Voice Selection - engine dependent */}
          {engine === 'cosyvoice' ? (
            <VoiceSelector
              selectedVoiceId={selectedVoiceId}
              onVoiceSelect={setSelectedVoiceId}
            />
          ) : engine === 'edge_tts' ? (
            <EdgeTTSPanel
              selectedVoice={edgeVoice}
              onVoiceSelect={setEdgeVoice}
            />
          ) : (
            <MiMoTTSPanel
              mode={mimoMode}
              onModeChange={setMimoMode}
              onPresetVoiceSelect={setMimoPresetVoice}
              selectedPresetVoice={mimoPresetVoice}
              onVoiceDescriptionChange={setMimoVoiceDescription}
              voiceDescription={mimoVoiceDescription}
              onSynthTextChange={setMimoSynthText}
              synthText={mimoSynthText}
              onInstructionChange={setMimoInstruction}
              instruction={mimoInstruction}
              onCloneVoiceSelect={setMimoCloneVoiceId}
              selectedCloneVoiceId={mimoCloneVoiceId}
              optimizeTextPreview={mimoOptimizeText}
              onOptimizeTextPreviewChange={setMimoOptimizeText}
            />
          )}
        </div>

        {/* Right Column: Params & Player & History */}
        <div className={styles.rightColumn}>
          {/* Parameter Controls - engine dependent */}
          {engine === 'cosyvoice' ? (
            <ParameterControls
              params={params}
              onParamChange={setParams}
            />
          ) : engine === 'edge_tts' ? (
            <EdgeTTSParameterControls
              rate={edgeRate}
              volume={edgeVolume}
              onRateChange={setEdgeRate}
              onVolumeChange={setEdgeVolume}
            />
          ) : null}

          {/* Generate Button */}
          <button
            onClick={handleSynthesize}
            disabled={isLoading || !canSynthesize}
            className={styles.generateButton}
          >
            {isLoading ? '生成中...' : '生成语音'}
          </button>

          {/* Audio Player */}
          <AudioPlayer result={result} isLoading={isLoading} />

          {/* Synthesis History */}
          <SynthesisHistory
            results={history}
            onDelete={handleDeleteResult}
            onPlay={handlePlayResult}
          />
        </div>
      </div>
    </div>
  );
}
