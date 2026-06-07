import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import {
  saveProject,
  getProject,
  listProjects,
  deleteProject,
} from '../segmentedProjectDB';
import { saveTTSResult, getTTSAudioBlob } from '../indexedDB';
import type { SegmentedProject } from '../../types';

function makeProject(overrides: Partial<SegmentedProject> = {}): SegmentedProject {
  const now = new Date().toISOString();
  return {
    schema_version: 1,
    id: 'p1',
    name: 'Test',
    segments: [],
    default_params: { engine: 'cosyvoice' },
    split_config: { delimiters: ['，', '。'], mode: 'rule' },
    layout: 'vertical',
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

describe('segmentedProjectDB', () => {
  it('saves and retrieves a project', async () => {
    const p = makeProject({ id: 'a', name: 'Hello' });
    await saveProject(p);
    const got = await getProject('a');
    expect(got?.name).toBe('Hello');
  });

  it('lists projects sorted by updated_at desc', async () => {
    await saveProject(makeProject({ id: 'list_1', updated_at: '2026-01-01T00:00:00Z' }));
    await saveProject(makeProject({ id: 'list_2', updated_at: '2026-06-01T00:00:00Z' }));
    await saveProject(makeProject({ id: 'list_3', updated_at: '2026-03-01T00:00:00Z' }));
    const list = await listProjects();
    const ids = list.map(p => p.id);
    expect(ids.indexOf('list_2')).toBeLessThan(ids.indexOf('list_3'));
    expect(ids.indexOf('list_3')).toBeLessThan(ids.indexOf('list_1'));
  });

  it('deleteProject also cleans orphan audio in ttsResults', async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/wav' });
    await saveTTSResult({
      id: 'audio_a', text: 't', voice_id: 'v', voice_name: 'n',
      audioBlob: blob, audio_format: 'wav', speed: 1, volume: 80, pitch: 1,
      instruction: '', language: 'Chinese',
      created_at: new Date().toISOString(), source: 'segmented_tts',
    });
    await saveTTSResult({
      id: 'audio_b', text: 't', voice_id: 'v', voice_name: 'n',
      audioBlob: blob, audio_format: 'wav', speed: 1, volume: 80, pitch: 1,
      instruction: '', language: 'Chinese',
      created_at: new Date().toISOString(), source: 'segmented_tts',
    });

    const now = new Date().toISOString();
    await saveProject(makeProject({
      id: 'pa',
      segments: [
        { id: 's1', text: 'a', params: { engine: 'cosyvoice' }, status: 'ready',
          current_audio_id: 'audio_a', previous_audio_id: 'audio_b',
          created_at: now, updated_at: now },
      ],
    }));

    await deleteProject('pa');

    expect(await getTTSAudioBlob('audio_a')).toBeNull();
    expect(await getTTSAudioBlob('audio_b')).toBeNull();
  });

  it('deleting a non-existent project does not throw', async () => {
    await expect(deleteProject('nope')).resolves.toBeUndefined();
  });
});
