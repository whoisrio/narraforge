import { describe, it, expect } from 'vitest';
import { unzipSync } from 'fflate';
import { buildRecordingsZip, downloadName } from './tryExport';
import type { TTSLocalRecord } from '../types';

function makeRecord(id: string, bytes: number[], format = 'mp3'): TTSLocalRecord {
  return {
    id,
    text: `record ${id}`,
    voice_id: 'en-US-AvaNeural',
    voice_name: 'Ava',
    audioBlob: new Blob([new Uint8Array(bytes)], { type: 'audio/mpeg' }),
    audio_format: format,
    speed: 1,
    volume: 100,
    pitch: 1,
    instruction: '',
    language: 'English',
    created_at: new Date().toISOString(),
  };
}

describe('tryExport', () => {
  it('names single downloads from record id and audio format', () => {
    expect(downloadName(makeRecord('abc', [1]))).toBe('narraforge-abc.mp3');
    expect(downloadName(makeRecord('abc', [1], 'wav'))).toBe('narraforge-abc.wav');
  });

  it('packs every record into a single zip with original bytes', async () => {
    const blob = await buildRecordingsZip([
      makeRecord('r1', [1, 2, 3]),
      makeRecord('r2', [4, 5]),
    ]);

    expect(blob.type).toBe('application/zip');
    const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    expect(Object.keys(files).sort()).toEqual(['narraforge-r1.mp3', 'narraforge-r2.mp3']);
    expect(Array.from(files['narraforge-r1.mp3'])).toEqual([1, 2, 3]);
    expect(Array.from(files['narraforge-r2.mp3'])).toEqual([4, 5]);
  });

  it('produces an empty zip for an empty history', async () => {
    const blob = await buildRecordingsZip([]);
    const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    expect(Object.keys(files)).toHaveLength(0);
  });
});
