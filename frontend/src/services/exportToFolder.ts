/**
 * 前端模式：把分段音频 + 字幕直接导出到用户指定的本地文件夹。
 *
 * 优先 File System Access API（showDirectoryPicker，Chrome/Edge）：
 * 选目录后逐段写入音频（保持原格式 mp3/wav）+ 章节 SRT。
 * Safari/Firefox 不支持时降级为逐文件浏览器下载（进默认下载目录）。
 */
import type { Segment } from '../types';
import { buildExportTimeline, buildSRTContent } from './audioConcat';
import { stripStyleTags } from './styleTags';
import { getTTSAudioBlob } from './indexedDB';

function sanitizeName(name: string): string {
  return (name || 'segment').replace(/[/\\:*?"<>|]/g, '_').slice(0, 80);
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

interface FileSystemWritableFileStreamLike {
  write(data: Blob | Uint8Array): Promise<void>;
  close(): Promise<void>;
}

interface FileHandleLike {
  createWritable(): Promise<FileSystemWritableFileStreamLike>;
}

interface DirectoryHandleLike {
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileHandleLike>;
}

async function writeToDir(dir: DirectoryHandleLike, name: string, data: Blob): Promise<void> {
  const handle = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(data);
  await writable.close();
}

export interface ExportToFolderResult {
  audioFiles: number;
  skipped: number;
  srtWritten: boolean;
  /** 是否实际写入了用户选择的目录（false = 降级为浏览器下载） */
  usedDirectoryPicker: boolean;
}

/**
 * 导出章节分段音频 + SRT 到指定文件夹。
 *
 * @param segments 章节全部段（内部按 ready 段筛选并构建连续时间轴）
 * @param chapterName 章节名（用于文件名）
 * @param startOffsetSec SRT 全局时间偏移（秒）
 * @param includeSrt 是否同时写 SRT
 */
export async function exportChapterToFolder(
  segments: Segment[],
  chapterName: string,
  options: { startOffsetSec?: number; includeSrt?: boolean } = {},
): Promise<ExportToFolderResult> {
  const { startOffsetSec = 0, includeSrt = true } = options;
  const base = sanitizeName(chapterName || 'chapter');
  const timeline = buildExportTimeline(segments, 'frontend', startOffsetSec);

  // 浏览器是否支持目录选择
  const picker = (window as unknown as {
    showDirectoryPicker?: () => Promise<DirectoryHandleLike>;
  }).showDirectoryPicker;
  const dir = picker ? await picker() : undefined;

  let audioFiles = 0;
  let skipped = 0;

  for (const seg of timeline) {
    const entry = seg.audio.current;
    if (!entry?.id) { skipped += 1; continue; }
    const blob = await getTTSAudioBlob(entry.id);
    if (!blob) { skipped += 1; continue; }
    const fmt = seg.audio.format ?? 'mp3';
    const label = sanitizeName(seg.text.slice(0, 12).trim() || `seg-${(seg.position ?? 0) + 1}`);
    const filename = `${base}_${String((seg.position ?? 0) + 1).padStart(2, '0')}_${label}.${fmt}`;
    if (dir) {
      await writeToDir(dir, filename, blob);
    } else {
      downloadBlob(blob, filename);
    }
    audioFiles += 1;
  }

  let srtWritten = false;
  if (includeSrt && timeline.length > 0) {
    const srt = buildSRTContent(timeline.map((s) => ({
      text: stripStyleTags(s.text),
      startMs: s._startMs,
      endMs: s._endMs,
    })));
    const srtBlob = new Blob([srt], { type: 'text/plain' });
    if (dir) {
      await writeToDir(dir, `${base}.srt`, srtBlob);
    } else {
      downloadBlob(srtBlob, `${base}.srt`);
    }
    srtWritten = true;
  }

  return { audioFiles, skipped, srtWritten, usedDirectoryPicker: !!dir };
}
