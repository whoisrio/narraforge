import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { saveTTSResult, getTTSHistory, getTTSAudioBlob } from '../indexedDB';
import type { TTSLocalRecord } from '../../types';

function makeRecord(id: string, source?: string): TTSLocalRecord {
  return {
    id, text: 't', voice_id: '', voice_name: '',
    audioBlob: new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/webm' }),
    audio_format: 'webm', speed: 1, volume: 80, pitch: 1,
    instruction: '', language: 'Chinese',
    created_at: new Date().toISOString(),
    ...(source ? { source } : {}),
  };
}

describe('indexedDB segmented_record source', () => {
  it('getTTSHistory excludes segmented_record and segmented_tts, keeps generic records', async () => {
    await saveTTSResult(makeRecord('segrec_a', 'segmented_record'));
    await saveTTSResult(makeRecord('segtts_a', 'segmented_tts'));
    await saveTTSResult(makeRecord('plain_a'));

    const history = await getTTSHistory();
    const ids = history.map(r => r.id);
    expect(ids).toContain('plain_a');
    expect(ids).not.toContain('segrec_a');
    expect(ids).not.toContain('segtts_a');
  });

  it('recorded segment blob stays retrievable by id (playback channel)', async () => {
    await saveTTSResult(makeRecord('segrec_b', 'segmented_record'));
    const blob = await getTTSAudioBlob('segrec_b');
    expect(blob).not.toBeNull();
  });
});
