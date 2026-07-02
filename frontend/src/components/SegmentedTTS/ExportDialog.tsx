import { useState, useCallback } from 'react';
import type { Segment } from '../../types';
import { useTranslation } from '../../i18n';
import { useStorageMode } from '../../hooks/useStorageMode';
import { segParams } from '../../services/segmentShims';
import { segmentedProjectApi, subtitleLlmApi } from '../../services/api';
import { buildSRTContent, concatAudioBuffers, encodeWAV } from '../../services/audioConcat';
import { getTTSAudioBlob } from '../../services/indexedDB';
import styles from './ExportDialog.module.css';

interface ExportDialogProps {
  open: boolean;
  projectId: string;
  chapterId: string;
  segments: Segment[];
  chapterDesignTitle?: string;
  remotionProjectPath?: string | null;
  /** Relative export directory under remotion project path (e.g. "public/audio") */
  exportDirectory?: string | null;
  defaultName: string;
  /** Start time offset for global SRT timestamps (seconds) */
  globalStartOffset?: number;
  onClose: () => void;
}

type ExportOption = 'audio' | 'json' | 'srt' | 'bilingual_srt';

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function ExportDialog({ open, projectId, chapterId, segments, chapterDesignTitle, remotionProjectPath, exportDirectory, defaultName, globalStartOffset = 0, onClose }: ExportDialogProps) {
  const { mode: storageMode } = useStorageMode();
  const [name, setName] = useState(defaultName);
  const [options, setOptions] = useState<ExportOption[]>(['audio', 'json']);
  const [srtUseGlobalTime, setSrtUseGlobalTime] = useState(globalStartOffset > 0);
  const [targetLang, setTargetLang] = useState('English');
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useTranslation();

  const toggleOpt = useCallback((opt: ExportOption) => {
    setOptions(prev => prev.includes(opt) ? prev.filter(x => x !== opt) : [...prev, opt]);
  }, []);

  const doExport = useCallback(async () => {
    if (!options.length) return;
    setExporting(true);
    try {
      const sanitized = name.replace(/[/\\\\:*?"<>|]/g, '_') || 'export';
      const exportTextFile = async (filename: string, content: string, mimeType: string) => {
        if (storageMode === 'backend' && remotionProjectPath) {
          await segmentedProjectApi.exportTextFileToRemotion(projectId, filename, content, exportDirectory);
          return;
        }
        downloadBlob(new Blob([content], { type: mimeType }), filename);
      };
      const startOffset = srtUseGlobalTime ? globalStartOffset : 0;
      let accumulated_ms = startOffset * 1000;
      const segsWithTs = segments.map((s) => {
        const start = accumulated_ms;
        const end = start + (s.audio.duration_sec ?? 0) * 1000;
        accumulated_ms = end;
        return { ...s, _startMs: start, _endMs: end };
      });

      // Audio: backend storage exports MP3 from server; frontend storage keeps WAV concat.
      if (options.includes('audio')) {
        const ready = segsWithTs.filter(s => (
          s.status === 'ready' && (storageMode === 'backend' ? s.audio.current?.path : s.audio.current?.id)
        ));
        if (ready.length < segsWithTs.length) {
          const confirmMsg = t('segment.exportDialog.confirmSkip', { 
            failed: String(segsWithTs.length - ready.length), 
            total: String(segsWithTs.length) 
          });
          if (!confirm(confirmMsg)) {
            setExporting(false); return;
          }
        }
        if (storageMode === 'backend') {
          const resp = await fetch(segmentedProjectApi.getChapterAudioExportUrl(projectId, chapterId, exportDirectory));
          if (!resp.ok) {
            let detail = `HTTP ${resp.status}`;
            try {
              const body = await resp.clone().json();
              if (body?.detail) detail = `${resp.status} ${body.detail}`;
            } catch {
              try { detail = `${resp.status} ${await resp.text()}`.slice(0, 200); } catch { /* ignore */ }
            }
            throw new Error(`${t('export.mp3ExportFailed')}${detail}`);
          }
          const blob = await resp.blob();
          if (!remotionProjectPath) {
            downloadBlob(blob, `${sanitized}.mp3`);
          }
        } else {
          const buffers: AudioBuffer[] = [];
          for (const s of ready) {
            const current = s.audio.current;
            if (!current?.id) continue;
            const blob = await getTTSAudioBlob(current.id);
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
      }

      // JSON
      if (options.includes('json')) {
        const json = JSON.stringify({
          name, schema_version: 1, created_at: new Date().toISOString(),
          chapter_design_title: chapterDesignTitle,
          total_duration_sec: segsWithTs.reduce((a, s) => a + (s.audio.duration_sec ?? 0), 0),
          segments: segsWithTs.map(s => ({
            text: s.text, ssml: '', params: segParams(s),
            start_ms: s._startMs, end_ms: s._endMs, duration_sec: s.audio.duration_sec ?? 0,
          })),
        }, null, 2);
        await exportTextFile(`${sanitized}.script.json`, json, 'application/json');
      }

      // SRT
      if (options.includes('srt')) {
        const srt = buildSRTContent(segsWithTs.map(s => ({
          text: s.text, startMs: s._startMs, endMs: s._endMs,
        })));
        await exportTextFile(`${sanitized}.srt`, srt, 'text/plain');
      }

      // Bilingual SRT
      if (options.includes('bilingual_srt')) {
        try {
          const srt = buildSRTContent(segsWithTs.map(s => ({
            text: s.text, startMs: s._startMs, endMs: s._endMs,
          })));
          const result = await subtitleLlmApi.translate(srt, targetLang, 'Chinese');
          await exportTextFile(`${sanitized}.bilingual.srt`, result.bilingual_srt, 'text/plain');
        } catch {
          setError(t('export.errorTranslationFailed'));
          setTimeout(() => setError(null), 5000);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('export.errorExportFailed'));
      setTimeout(() => setError(null), 5000);
    } finally {
      setExporting(false);
    }
  }, [segments, name, options, targetLang, storageMode, projectId, chapterId, chapterDesignTitle, remotionProjectPath, exportDirectory, srtUseGlobalTime, globalStartOffset, t]);

  if (!open) return null;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.dialog} onClick={e => e.stopPropagation()}>
        <h3>{t('segment.exportDialog.title')}</h3>
        <div className={styles.field}>
          <label>{t('segment.exportDialog.name')}</label>
          <input value={name} onChange={e => setName(e.target.value)} />
        </div>
        <div className={styles.options}>
          <label><input type="checkbox" checked={options.includes('audio')} onChange={() => toggleOpt('audio')} /> {storageMode === 'backend' ? t('export.audioMp3') : t('export.audioWav')}</label>
          <label><input type="checkbox" checked={options.includes('json')} onChange={() => toggleOpt('json')} /> {t('export.scriptJson')}</label>
          <label><input type="checkbox" checked={options.includes('srt')} onChange={() => toggleOpt('srt')} /> {t('export.srtSubtitle')}</label>
          {options.includes('srt') && globalStartOffset > 0 && (
            <label style={{ marginLeft: '20px', fontSize: '0.9em' }}>
              <input type="checkbox" checked={srtUseGlobalTime} onChange={(e) => setSrtUseGlobalTime(e.target.checked)} /> {t('export.srtGlobalTime')}
            </label>
          )}
          <label><input type="checkbox" checked={options.includes('bilingual_srt')} onChange={() => toggleOpt('bilingual_srt')} /> {t('export.bilingualSrt')}</label>
        </div>
        {options.includes('bilingual_srt') && (
          <div className={styles.langRow}>
            <select value={targetLang} onChange={e => setTargetLang(e.target.value)}>
              <option>English</option><option>Japanese</option><option>Korean</option>
            </select>
          </div>
        )}
        {error && <div className={styles.error}>{error}</div>}
        <div className={styles.buttons}>
          <button className={styles.cancelBtn} onClick={onClose}>{t('segment.exportDialog.cancel')}</button>
          <button className={styles.exportBtn} onClick={doExport} disabled={exporting}>
            {exporting ? t('export.exporting') : t('export.startExport')}
          </button>
        </div>
      </div>
    </div>
  );
}
