import { useState, useCallback } from 'react';
import type { Segment } from '../../types';
import { getTTSAudioBlob } from '../../services/indexedDB';
import { subtitleLlmApi } from '../../services/api';
import { buildSRTContent, concatAudioBuffers, encodeWAV } from '../../services/audioConcat';
import styles from './ExportDialog.module.css';

interface ExportDialogProps {
  open: boolean;
  segments: Segment[];
  defaultName: string;
  onClose: () => void;
}

type ExportOption = 'wav' | 'json' | 'srt' | 'bilingual_srt';

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function ExportDialog({ open, segments, defaultName, onClose }: ExportDialogProps) {
  const [name, setName] = useState(defaultName);
  const [options, setOptions] = useState<ExportOption[]>(['wav', 'json']);
  const [targetLang, setTargetLang] = useState('English');
  const [exporting, setExporting] = useState(false);

  const toggleOpt = useCallback((opt: ExportOption) => {
    setOptions(prev => prev.includes(opt) ? prev.filter(x => x !== opt) : [...prev, opt]);
  }, []);

  const doExport = useCallback(async () => {
    if (!options.length) return;
    setExporting(true);
    try {
      const sanitized = name.replace(/[/\\:*?"<>|]/g, '_') || 'export';
      let accumulated_ms = 0;
      const segsWithTs = segments.map((s) => {
        const start = accumulated_ms;
        const end = start + (s.duration_sec ?? 0) * 1000;
        accumulated_ms = end;
        return { ...s, _startMs: start, _endMs: end };
      });

      // WAV
      if (options.includes('wav')) {
        const ready = segsWithTs.filter(s => s.status === 'ready' && s.current_audio_id);
        if (ready.length < segsWithTs.length) {
          if (!confirm(`${segsWithTs.length - ready.length}/${segsWithTs.length} 段未生成，将跳过。继续？`)) {
            setExporting(false); return;
          }
        }
        const buffers: AudioBuffer[] = [];
        for (const s of ready) {
          const blob = await getTTSAudioBlob(s.current_audio_id!);
          if (!blob) continue;
          try {
            const ac = new AudioContext();
            const ab = await ac.decodeAudioData(await blob.arrayBuffer());
            buffers.push(ab);
            ac.close();
          } catch { /* skip undecodable */ }
        }
        if (buffers.length > 0) {
          const targetRate = Math.max(...buffers.map(b => b.sampleRate));
          const samples = concatAudioBuffers(buffers, targetRate);
          downloadBlob(encodeWAV(samples, targetRate), `${sanitized}.wav`);
        }
      }

      // JSON
      if (options.includes('json')) {
        const json = JSON.stringify({
          name, schema_version: 1, created_at: new Date().toISOString(),
          total_duration_sec: segsWithTs.reduce((a, s) => a + (s.duration_sec ?? 0), 0),
          segments: segsWithTs.map(s => ({
            text: s.text, ssml: s.ssml, params: s.params,
            start_ms: s._startMs, end_ms: s._endMs, duration_sec: s.duration_sec ?? 0,
          })),
        }, null, 2);
        downloadBlob(new Blob([json], { type: 'application/json' }), `${sanitized}.script.json`);
      }

      // SRT
      if (options.includes('srt')) {
        const srt = buildSRTContent(segsWithTs.map(s => ({
          text: s.text, startMs: s._startMs, endMs: s._endMs,
        })));
        downloadBlob(new Blob([srt], { type: 'text/plain' }), `${sanitized}.srt`);
      }

      // Bilingual SRT
      if (options.includes('bilingual_srt')) {
        try {
          const srt = buildSRTContent(segsWithTs.map(s => ({
            text: s.text, startMs: s._startMs, endMs: s._endMs,
          })));
          const result = await subtitleLlmApi.translate(srt, targetLang, 'Chinese');
          downloadBlob(new Blob([result.bilingual_srt], { type: 'text/plain' }), `${sanitized}.bilingual.srt`);
        } catch {
          alert('双语 SRT 翻译失败，其他文件已导出。');
        }
      }
    } finally {
      setExporting(false);
    }
  }, [segments, name, options, targetLang]);

  if (!open) return null;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.dialog} onClick={e => e.stopPropagation()}>
        <h3>导出选项</h3>
        <div className={styles.field}>
          <label>名称</label>
          <input value={name} onChange={e => setName(e.target.value)} />
        </div>
        <div className={styles.options}>
          <label><input type="checkbox" checked={options.includes('wav')} onChange={() => toggleOpt('wav')} /> WAV 音频</label>
          <label><input type="checkbox" checked={options.includes('json')} onChange={() => toggleOpt('json')} /> 脚本 JSON</label>
          <label><input type="checkbox" checked={options.includes('srt')} onChange={() => toggleOpt('srt')} /> SRT 字幕</label>
          <label><input type="checkbox" checked={options.includes('bilingual_srt')} onChange={() => toggleOpt('bilingual_srt')} /> 双语 SRT 字幕</label>
        </div>
        {options.includes('bilingual_srt') && (
          <div className={styles.langRow}>
            <select value={targetLang} onChange={e => setTargetLang(e.target.value)}>
              <option>English</option><option>Japanese</option><option>Korean</option>
            </select>
          </div>
        )}
        <div className={styles.buttons}>
          <button className={styles.cancelBtn} onClick={onClose}>取消</button>
          <button className={styles.exportBtn} onClick={doExport} disabled={exporting}>
            {exporting ? '导出中...' : '开始导出'}
          </button>
        </div>
      </div>
    </div>
  );
}
