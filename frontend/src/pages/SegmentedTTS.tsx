import { useState, useCallback } from 'react';
import { TextInputPanel } from '../components/SegmentedTTS/TextInputPanel';
import { SegmentList } from '../components/SegmentedTTS/SegmentList';
import { SegmentEditDrawer } from '../components/SegmentedTTS/SegmentEditDrawer';
import { ProjectToolbar } from '../components/SegmentedTTS/ProjectToolbar';
import { ExportDialog } from '../components/SegmentedTTS/ExportDialog';
import { useSegmentedProject } from '../hooks/useSegmentedProject';
import { textSplitApi, ttsApi, mimoTtsApi } from '../services/api';
import { saveTTSResult, deleteTTSResult, getTTSAudioBlob } from '../services/indexedDB';
import type { SegmentedProject } from '../types';
import styles from './SegmentedTTS.module.css';

export function SegmentedTTS() {
  const [state, dispatch] = useSegmentedProject();
  const { project } = state;
  const [exportOpen, setExportOpen] = useState(false);
  const [generating, setGenerating] = useState(false);

  const editingSegment = project.segments.find(s => s.id === project.selected_segment_id) ?? null;

  // ----- Split handlers -----

  const handleSplit = (texts: string[]) => {
    dispatch({ type: 'APPLY_SPLIT', texts });
  };

  const handleLLMSplit = async (text: string) => {
    const result = await textSplitApi.llmSplit(text);
    const texts = result.segments.map(s => s.text);
    dispatch({ type: 'APPLY_SPLIT', texts });
  };

  const handleSplitConfigChange = (config: SegmentedProject['split_config']) => {
    dispatch({ type: 'SET_SPLIT_CONFIG', config });
  };

  // ----- TTS Regenerate -----

  const handleRegenerate = useCallback(async (id: string) => {
    const seg = project.segments.find(s => s.id === id);
    if (!seg) return;
    dispatch({ type: 'GENERATE_START', id });
    try {
      const p = seg.params;
      const textToSend = (p.enable_ssml && seg.ssml) ? seg.ssml : seg.text;
      let result: { audio_base64?: string; audio_format?: string };

      if (p.engine === 'edge_tts') {
        result = await ttsApi.synthesize({
          text: textToSend,
          engine: 'edge_tts',
          voice_id: '',
          edge_voice: p.edge_voice ?? '',
          edge_rate: p.edge_rate ?? '+0%',
          edge_volume: p.edge_volume ?? '+0%',
          format: 'mp3',
        });
      } else if (p.engine === 'mimo_tts') {
        if (p.mimo_mode === 'preset') {
          result = await mimoTtsApi.synthesizePreset({
            text: textToSend,
            voice: p.mimo_preset_voice ?? '',
            instruction: p.mimo_instruction ?? '',
            format: 'wav',
          });
        } else {
          result = await mimoTtsApi.synthesizeVoiceClone({
            text: textToSend,
            voice_id: p.mimo_clone_voice_id ?? '',
            instruction: p.mimo_instruction ?? '',
            format: 'wav',
          });
        }
      } else {
        // CosyVoice (default)
        result = await ttsApi.synthesize({
          text: textToSend,
          voice_id: p.voice_id ?? '',
          language: (p.language ?? 'Chinese') as 'Chinese' | 'English' | 'Japanese' | 'Korean',
          speed: p.speed ?? 1.0,
          volume: p.volume ?? 80,
          pitch: p.pitch ?? 1.0,
          instruction: p.instruction ?? '',
          enable_ssml: p.enable_ssml ?? false,
          enable_markdown_filter: p.enable_markdown_filter ?? false,
          format: 'mp3',
        });
      }

      if (!result.audio_base64) throw new Error('No audio returned');

      const bytes = atob(result.audio_base64);
      const arr = new Uint8Array(bytes.length);
      for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
      const fmt = result.audio_format || 'mp3';
      const mime = fmt === 'mp3' ? 'audio/mpeg' : `audio/${fmt}`;
      const blob = new Blob([arr], { type: mime });

      const ac = new AudioContext();
      const ab = await ac.decodeAudioData(await blob.arrayBuffer());
      const duration = ab.duration;
      ac.close();

      const audioId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      await saveTTSResult({
        id: audioId,
        text: seg.text,
        voice_id: p.voice_id ?? '',
        voice_name: '',
        audioBlob: blob,
        audio_format: fmt,
        speed: p.speed ?? 1,
        volume: p.volume ?? 80,
        pitch: p.pitch ?? 1,
        instruction: p.instruction ?? '',
        language: p.language ?? 'Chinese',
        created_at: new Date().toISOString(),
        source: 'segmented_tts',
      });

      if (seg.previous_audio_id) {
        try { await deleteTTSResult(seg.previous_audio_id); } catch { /* ignore */ }
      }

      dispatch({ type: 'GENERATE_SUCCESS', id, audio_id: audioId, duration_sec: duration });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '生成失败';
      dispatch({ type: 'GENERATE_FAIL', id, error: msg });
    }
  }, [project.segments, dispatch]);

  // ----- Batch regenerate (concurrency=3) -----

  const handleRegenerateAll = useCallback(async () => {
    if (generating) return;
    setGenerating(true);
    const toGenerate = project.segments.filter(s => s.status === 'idle' || s.status === 'failed');
    dispatch({ type: 'MARK_QUEUED', ids: toGenerate.map(s => s.id) });
    let i = 0;
    const next = async () => {
      while (i < toGenerate.length) {
        const seg = toGenerate[i++];
        await handleRegenerate(seg.id);
      }
    };
    await Promise.all(Array.from({ length: 3 }, () => next()));
    setGenerating(false);
  }, [generating, project.segments, dispatch, handleRegenerate]);

  // ----- SSML annotation -----

  const handleAnnotateSSML = useCallback(async (idsArg?: string[]) => {
    const ids = idsArg ?? project.segments.filter(s => s.params.engine === 'cosyvoice').map(s => s.id);
    const targetSegs = project.segments.filter(s => ids.includes(s.id));
    if (!targetSegs.length) return;
    try {
      const result = await textSplitApi.ssmlAnnotate(targetSegs.map(s => s.text));
      const updates = targetSegs.map((s, i) => ({
        id: s.id,
        ssml: result.annotations[i]?.ssml ?? `<speak>${s.text}</speak>`,
      }));
      dispatch({ type: 'BATCH_SET_SSML', updates, by_llm: true });
      for (const s of targetSegs) {
        dispatch({ type: 'UPDATE_PARAMS', id: s.id, params: { enable_ssml: true } });
      }
    } catch {
      alert('SSML 标注失败，请检查 LLM 配置');
    }
  }, [project.segments, dispatch]);

  // ----- Single-segment SSML annotate (for SegmentEditDrawer) -----

  const handleAnnotateSSMLOne = useCallback(async (id: string) => {
    await handleAnnotateSSML([id]);
  }, [handleAnnotateSSML]);

  // ----- Play segment -----

  const handlePlaySegment = useCallback(async (id: string) => {
    const seg = project.segments.find(s => s.id === id);
    if (!seg?.current_audio_id) return;
    const blob = await getTTSAudioBlob(seg.current_audio_id);
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.play().finally(() => URL.revokeObjectURL(url));
  }, [project.segments]);

  // ----- Undo regenerate -----

  const handleUndo = useCallback((id: string) => {
    dispatch({ type: 'UNDO_REGENERATE', id });
  }, [dispatch]);

  // ----- SegmentList onRegenerate / onAnnotateSSML -----

  const handleRegenerateOne = useCallback((id: string) => {
    handleRegenerate(id);
  }, [handleRegenerate]);

  return (
    <div className={styles.container}>
      <ProjectToolbar
        project={project}
        onRename={(name) => dispatch({ type: 'RENAME_PROJECT', name })}
        onLayoutToggle={() => dispatch({
          type: 'SET_LAYOUT',
          layout: project.layout === 'vertical' ? 'horizontal' : 'vertical',
        })}
        onGenerateAll={handleRegenerateAll}
        onAnnotateAll={() => handleAnnotateSSML()}
        onExport={() => setExportOpen(true)}
      />
      <TextInputPanel
        splitConfig={project.split_config}
        onSplitConfigChange={handleSplitConfigChange}
        onSplit={handleSplit}
        onLLMSplit={handleLLMSplit}
      />
      <SegmentList
        segments={project.segments}
        layout={project.layout}
        selectedId={project.selected_segment_id}
        onSelect={(id) => dispatch({ type: 'SELECT_SEGMENT', id })}
        onDelete={(id) => dispatch({ type: 'DELETE_SEGMENT', id })}
        onInsertAfter={(afterId) => dispatch({ type: 'INSERT_SEGMENT', afterId })}
        onAppend={() => dispatch({ type: 'APPEND_SEGMENT', text: '' })}
        onReorder={(from, to) => dispatch({ type: 'REORDER', fromIndex: from, toIndex: to })}
        onEdit={(id) => {
          dispatch({ type: 'SELECT_SEGMENT', id });
          handlePlaySegment(id);
        }}
        onRegenerate={handleRegenerateOne}
        onUndo={handleUndo}
        onAnnotateSSML={handleAnnotateSSMLOne}
        onDuplicate={(id) => {
          const seg = project.segments.find(s => s.id === id);
          if (seg) {
            dispatch({ type: 'INSERT_SEGMENT', afterId: id, text: seg.text });
          }
        }}
      />
      {project.layout === 'vertical' ? (
        <SegmentEditDrawer
          segment={editingSegment}
          onClose={() => dispatch({ type: 'SELECT_SEGMENT', id: undefined })}
          onUpdateText={(id, text) => dispatch({ type: 'UPDATE_TEXT', id, text })}
          onUpdateSSML={(id, ssml) => dispatch({ type: 'UPDATE_SSML', id, ssml })}
          onUpdateParams={(id, params) => dispatch({ type: 'UPDATE_PARAMS', id, params })}
          onRegenerate={handleRegenerateOne}
          onAnnotateSSML={handleAnnotateSSMLOne}
        />
      ) : (
        editingSegment && (
          <div className={styles.inlineEditor}>
            <h4>编辑 #{editingSegment.id.slice(-3)}</h4>
            <textarea
              value={editingSegment.text}
              onChange={(e) => dispatch({ type: 'UPDATE_TEXT', id: editingSegment.id, text: e.target.value })}
              rows={2}
              className={styles.inlineEditorTextarea}
            />
            <div className={styles.inlineEditorActions}>
              <button onClick={() => handleRegenerate(editingSegment.id)}
                className={styles.inlineEditorBtnPrimary}>
                ↻ 重新生成
              </button>
              <button onClick={() => dispatch({ type: 'SELECT_SEGMENT', id: undefined })}
                className={styles.inlineEditorBtnSecondary}>
                关闭
              </button>
            </div>
          </div>
        )
      )}
      <ExportDialog
        open={exportOpen}
        segments={project.segments}
        defaultName={project.name}
        onClose={() => setExportOpen(false)}
      />
    </div>
  );
}
