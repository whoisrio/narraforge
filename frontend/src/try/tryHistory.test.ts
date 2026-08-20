import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  saveTryTTSRecord,
  listTryTTSRecords,
  deleteTryTTSRecord,
  clearTryTTSRecords,
} from './tryHistory';
import { saveTTSResult, getTTSHistory, _openDB, _TTS_STORE } from '../services/indexedDB';
import type { TTSLocalRecord } from '../types';

function makeRecord(id: string, overrides: Partial<TTSLocalRecord> = {}): TTSLocalRecord {
  return {
    id,
    text: 'hello',
    voice_id: 'en-US-AvaNeural',
    voice_name: 'Ava',
    audioBlob: new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/mpeg' }),
    audio_format: 'mp3',
    speed: 1,
    volume: 100,
    pitch: 1,
    instruction: '',
    language: 'English',
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

async function resetStore() {
  const db = await _openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(_TTS_STORE, 'readwrite');
    tx.objectStore(_TTS_STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

describe('tryHistory', () => {
  beforeEach(async () => {
    await resetStore();
  });

  it('saveTryTTSRecord tags record with source try_page', async () => {
    await saveTryTTSRecord(makeRecord('try_a'));
    const all = await getTTSHistory();
    const rec = all.find((r) => r.id === 'try_a');
    expect(rec?.source).toBe('try_page');
  });

  it('listTryTTSRecords returns only try_page records, newest first', async () => {
    await saveTryTTSRecord(makeRecord('try_old', { created_at: '2026-08-19T00:00:00Z' }));
    await saveTryTTSRecord(makeRecord('try_new', { created_at: '2026-08-20T00:00:00Z' }));
    await saveTTSResult(makeRecord('plain_x'));

    const list = await listTryTTSRecords();
    expect(list.map((r) => r.id)).toEqual(['try_new', 'try_old']);
  });

  it('deleteTryTTSRecord removes a single record', async () => {
    await saveTryTTSRecord(makeRecord('try_del'));
    await saveTryTTSRecord(makeRecord('try_keep'));

    await deleteTryTTSRecord('try_del');

    const list = await listTryTTSRecords();
    expect(list.map((r) => r.id)).toEqual(['try_keep']);
  });

  it('clearTryTTSRecords removes only try_page records', async () => {
    await saveTryTTSRecord(makeRecord('try_1'));
    await saveTryTTSRecord(makeRecord('try_2'));
    await saveTTSResult(makeRecord('plain_keep'));

    await clearTryTTSRecords();

    const tryList = await listTryTTSRecords();
    expect(tryList).toEqual([]);
    const all = await getTTSHistory();
    expect(all.map((r) => r.id)).toContain('plain_keep');
  });
});
