import type { TTSLocalRecord } from '../types';
import {
  saveTTSResult,
  getTTSHistory,
  deleteTTSResult,
} from '../services/indexedDB';

/**
 * Try 页（/try 获客页）的 TTS 历史记录。
 * 复用主应用同一个 tts_results store，以 source='try_page' 区分；
 * 用户进入完整版后这些记录在主历史里依然可见（getTTSHistory 只过滤分段来源）。
 */
export const TRY_TTS_SOURCE = 'try_page';

export async function saveTryTTSRecord(record: TTSLocalRecord): Promise<void> {
  await saveTTSResult({ ...record, source: TRY_TTS_SOURCE });
}

export async function listTryTTSRecords(): Promise<TTSLocalRecord[]> {
  const all = await getTTSHistory();
  return all.filter((r) => r.source === TRY_TTS_SOURCE);
}

export async function deleteTryTTSRecord(id: string): Promise<void> {
  await deleteTTSResult(id);
}

export async function clearTryTTSRecords(): Promise<void> {
  const records = await listTryTTSRecords();
  await Promise.all(records.map((r) => deleteTTSResult(r.id)));
}
