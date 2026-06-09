import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import type { SegmentedProject } from '../../types';
import { getDraft, putDraft, deleteDraft, listDrafts } from '../segmentedDraftStore';

function makeProject(id: string): SegmentedProject {
  const now = new Date().toISOString();
  return {
    schema_version: 2, id, name: 'x',
    chapters: [{
      id: 'c1', name: '第一章', engine: 'edge_tts',
      segments: [], default_params: { engine: 'edge_tts' },
      split_config: { delimiters: ['。'], mode: 'rule' },
      created_at: now, updated_at: now,
    }],
    layout: 'vertical', created_at: now, updated_at: now,
  };
}

describe('segmentedDraftStore', () => {
  beforeEach(async () => {
    const all = await listDrafts();
    for (const d of all) await deleteDraft(d.project_id);
  });

  it('round-trips a draft', async () => {
    const rec = {
      project_id: 'p1', draft: makeProject('p1'),
      base_updated_at: '2026-06-09T00:00:00',
      updated_at: '2026-06-09T00:00:00',
      dirty: true,
    };
    await putDraft(rec);
    const got = await getDraft('p1');
    expect(got?.dirty).toBe(true);
    expect(got?.draft.id).toBe('p1');
  });

  it('lists and deletes', async () => {
    await putDraft({
      project_id: 'p1', draft: makeProject('p1'),
      base_updated_at: null, updated_at: 't', dirty: true,
    });
    await putDraft({
      project_id: 'p2', draft: makeProject('p2'),
      base_updated_at: null, updated_at: 't', dirty: true,
    });
    expect((await listDrafts()).length).toBe(2);
    await deleteDraft('p1');
    expect((await listDrafts()).map(d => d.project_id)).toEqual(['p2']);
  });
});
