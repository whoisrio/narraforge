import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { VoiceSelector } from '../components/TTSSynthesis/VoiceSelector';
import { ParameterControls } from '../components/TTSSynthesis/ParameterControls';
import { EdgeTTSParameterControls } from '../components/TTSSynthesis/EdgeTTSParameterControls';
import { AudioPlayer } from '../components/TTSSynthesis/AudioPlayer';
import { SynthesisHistory } from '../components/TTSSynthesis/SynthesisHistory';
import { EdgeTTSPanel } from '../components/TTSSynthesis/EdgeTTSPanel';
import { ttsApi } from '../services/api';
import { saveTTSResult, getTTSHistory, deleteTTSResult, getTTSAudioBlob } from '../services/indexedDB';
import { useStorageMode } from '../hooks/useStorageMode';
import { useVoiceRefresh } from '../hooks/useVoiceRefresh';
import type { TTSRequest, TTSResult, TTSResultRecord, VoiceProfile } from '../types';
import styles from './TTSSynthesis.module.css';

type Engine = 'cosyvoice' | 'edge_tts';

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

  // Edge-TTS state - 拆分为声音 + 独立的语速/音量数值
  const [edgeVoice, setEdgeVoice] = useState('');
  const [edgeRate, setEdgeRate] = useState(0);
  const [edgeVolume, setEdgeVolume] = useState(0);

  const [result, setResult] = useState<TTSResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [history, setHistory] = useState<TTSResultRecord[]>([]);
  const [voices, setVoices] = useState<VoiceProfile[]>([]);

  // 建立 voice_id → description 映射，用于在历史记录中将 voice_name 替换为描述
  const voiceDescriptionMap = useMemo(() => {
    const map = new Map<string, string>();
    voices.forEach(v => {
      if (v.description && v.qwen_voice_id) {
        map.set(v.qwen_voice_id, v.description);
      }
    });
    return map;
  }, [voices]);

  // 加载声音列表，用于下拉选择和历史记录的描述匹配
  // refreshCounter 变化时重新拉取，确保 clone/delete/update description 后列表同步
  useEffect(() => {
    ttsApi.getVoices().then(setVoices).catch(() => {});
  }, [refreshCounter]);

  // 用 ref 跟踪当前模式，避免异步竞态：初始 backend 模式的结果覆盖后续 frontend 模式的结果
  const storageModeRef = useRef(storageMode);
  storageModeRef.current = storageMode;

  // 用 ref 确保 loadHistory 总能拿到最新的描述映射
  const voiceDescriptionMapRef = useRef(voiceDescriptionMap);
  voiceDescriptionMapRef.current = voiceDescriptionMap;

  /** 用声音描述替换 voice_name（优先显示描述） */
  const enrichVoiceName = useCallback((voiceId: string, voiceName: string) => {
    return voiceDescriptionMapRef.current.get(voiceId) || voiceName;
  }, []);

  // 保存 blob URL 以便清理，避免内存泄漏
  const blobUrlsRef = useRef<string[]>([]);

  // 清理上次加载产生的 blob URL
  const revokeBlobUrls = useCallback(() => {
    blobUrlsRef.current.forEach(url => URL.revokeObjectURL(url));
    blobUrlsRef.current = [];
  }, []);

  const loadHistory = useCallback(async () => {
    const modeAtStart = storageModeRef.current;
    try {
      if (modeAtStart === 'frontend') {
        // 前端存储模式：从 IndexedDB 加载
        const localRecords = await getTTSHistory();
        // 如果在此期间模式已切换，丢弃本次结果
        if (storageModeRef.current !== modeAtStart) return;

        // 清理旧的 blob URL，为每条记录生成新的
        revokeBlobUrls();

        // 将 TTSLocalRecord 转换为 TTSResultRecord 格式
        const mapped: TTSResultRecord[] = localRecords.map((r) => {
          // 旧记录可能没有 audioBlob，此时不生成播放 URL
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
        // 如果在此期间模式已切换，丢弃本次结果
        if (storageModeRef.current !== modeAtStart) return;
        // 用声音描述替换 voice_name
        const enriched = data.map(r => ({
          ...r,
          voice_name: enrichVoiceName(r.voice_id, r.voice_name),
        }));
        setHistory(enriched);
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

    try {
      setIsLoading(true);
      setResult(null);

      if (engine === 'edge_tts') {
        const response = await ttsApi.synthesize({
          text,
          engine: 'edge_tts',
          voice_id: '',
          edge_voice: edgeVoice,
          edge_rate: toEdgeFormat(edgeRate),
          edge_volume: toEdgeFormat(edgeVolume),
          format: 'mp3',
        });

        // 前端存储模式：将 base64 结果存入 IndexedDB
        if (storageMode === 'frontend' && response.audio_base64) {
          const byteStr = atob(response.audio_base64);
          const byteNums = new Uint8Array(byteStr.length);
          for (let i = 0; i < byteStr.length; i++) {
            byteNums[i] = byteStr.charCodeAt(i);
          }
          await saveTTSResult({
            id: response.audio_id,
            text: response.text,
            voice_id: response.voice_id || '',
            voice_name: response.voice_name || '',
            audioBlob: new Blob([byteNums], { type: 'audio/mpeg' }),
            audio_format: 'mp3',
            speed: 1.0,
            volume: edgeVolume,
            pitch: 1.0,
            instruction: '',
            language: 'Chinese',
            created_at: new Date().toISOString(),
          });
        }

        setResult(response);
      } else {
        const response = await ttsApi.synthesize({
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

        // 前端存储模式：将 base64 结果存入 IndexedDB
        if (storageMode === 'frontend' && response.audio_base64) {
          const byteStr = atob(response.audio_base64);
          const byteNums = new Uint8Array(byteStr.length);
          for (let i = 0; i < byteStr.length; i++) {
            byteNums[i] = byteStr.charCodeAt(i);
          }
          await saveTTSResult({
            id: response.audio_id,
            text: response.text,
            voice_id: response.voice_id || '',
            voice_name: response.voice_name || '',
            audioBlob: new Blob([byteNums], { type: 'audio/mpeg' }),
            audio_format: response.audio_format || 'mp3',
            speed: response.params.speed ?? 1.0,
            volume: response.params.volume ?? 80,
            pitch: response.params.pitch ?? 1.0,
            instruction: response.params.instruction || '',
            language: response.params.language || 'Chinese',
            created_at: new Date().toISOString(),
          });
        }

        setResult(response);
      }

      loadHistory();
    } catch (error) {
      console.error('TTS synthesis failed:', error);
      alert('生成语音失败，请重试');
    } finally {
      setIsLoading(false);
    }
  }, [text, engine, selectedVoiceId, edgeVoice, edgeRate, edgeVolume, params, loadHistory, storageMode]);

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
      // 前端存储模式：从 IndexedDB 加载 Blob 转为 base64 播放
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
      </div>

      <div className={styles.content}>
        {/* Left Column: Input & Voice */}
        <div className={styles.leftColumn}>
          {/* Text Input */}
          <div className={styles.textSection}>
            <textarea
              className={styles.textarea}
              placeholder="输入要合成的文字..."
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={8}
            />
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
          ) : (
            <EdgeTTSPanel
              selectedVoice={edgeVoice}
              onVoiceSelect={setEdgeVoice}
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
          ) : (
            <EdgeTTSParameterControls
              rate={edgeRate}
              volume={edgeVolume}
              onRateChange={setEdgeRate}
              onVolumeChange={setEdgeVolume}
            />
          )}

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
