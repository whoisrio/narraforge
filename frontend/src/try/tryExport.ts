/**
 * Try 页录音导出：单条命名 + 全量打包（zip）。
 */
import { zipSync } from 'fflate';
import type { TTSLocalRecord } from '../types';

/** 单条录音的下载文件名：narraforge-{id}.{format} */
export function downloadName(record: TTSLocalRecord): string {
  return `narraforge-${record.id}.${record.audio_format || 'mp3'}`;
}

/** 全部录音打包为一个 zip（内存中完成，文件名与单条下载一致）。 */
export async function buildRecordingsZip(records: TTSLocalRecord[]): Promise<Blob> {
  const entries: Record<string, Uint8Array> = {};
  for (const record of records) {
    entries[downloadName(record)] = new Uint8Array(await record.audioBlob.arrayBuffer());
  }
  const zipped = zipSync(entries);
  // fflate 返回 Uint8Array<ArrayBufferLike>；实际为全新 ArrayBuffer（offset 0），直接取 buffer 构造 Blob
  return new Blob([zipped.buffer as ArrayBuffer], { type: 'application/zip' });
}
