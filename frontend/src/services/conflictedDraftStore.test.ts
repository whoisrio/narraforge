import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import type { ProjectDraftRecord } from './segmentedDraftStore';
import {
  putConflictedDraft,
  listConflictedDrafts,
  deleteConflictedDraft,
  clearConflictedDrafts,
} from './conflictedDraftStore';

function makeRecord(projectId: string, updatedAt: string): ProjectDraftRecord {
  return {
    project_id: projectId,
    draft: {
      schema_version: 2, id: projectId, name: 'x', layout: 'vertical',
      chapters: [], created_at: updatedAt, updated_at: updatedAt,
    },
    base_updated_at: '2026-09-23T00:00:00',
    updated_at: updatedAt,
    dirty: true,
  };
}

beforeEach(async () => {
  await clearConflictedDrafts();
});

describe('conflictedDraftStore（409 真冲突草稿归档）', () => {
  it('归档后可按项目列出，含 archived_at 与完整草稿记录', async () => {
    const rec = makeRecord('p1', '2026-09-23T01:00:00');
    const entry = await putConflictedDraft('p1', rec);
    expect(entry.id).toBeTruthy();
    expect(entry.project_id).toBe('p1');
    expect(entry.archived_at).toBeTruthy();

    const list = await listConflictedDrafts('p1');
    expect(list).toHaveLength(1);
    expect(list[0].record).toEqual(rec);
  });

  it('列表按归档时间降序（新归档在前），且只含目标项目', async () => {
    const a = await putConflictedDraft('p1', makeRecord('p1', '2026-09-23T01:00:00'));
    // 保证 archived_at 严格递增
    await new Promise(r => setTimeout(r, 5));
    await putConflictedDraft('p2', makeRecord('p2', '2026-09-23T02:00:00'));
    await new Promise(r => setTimeout(r, 5));
    const c = await putConflictedDraft('p1', makeRecord('p1', '2026-09-23T03:00:00'));

    const p1 = await listConflictedDrafts('p1');
    expect(p1.map(e => e.id)).toEqual([c.id, a.id]);

    const all = await listConflictedDrafts();
    expect(all).toHaveLength(3);
  });

  it('同一项目超过 10 份时淘汰最旧归档（prune）', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 12; i++) {
      const entry = await putConflictedDraft('p1', makeRecord('p1', `2026-09-23T0${i}:00:00`));
      ids.push(entry.id);
      await new Promise(r => setTimeout(r, 2));
    }
    const list = await listConflictedDrafts('p1');
    expect(list).toHaveLength(10);
    // 最旧的两份被淘汰
    expect(list.map(e => e.id)).not.toContain(ids[0]);
    expect(list.map(e => e.id)).not.toContain(ids[1]);
    expect(list.map(e => e.id)).toContain(ids[11]);
  });

  it('不同项目独立计数（p2 归档不受 p1 淘汰影响）', async () => {
    const first = await putConflictedDraft('p1', makeRecord('p1', '2026-09-23T01:00:00'));
    for (let i = 0; i < 11; i++) {
      await putConflictedDraft('p2', makeRecord('p2', '2026-09-23T01:00:00'));
      await new Promise(r => setTimeout(r, 2));
    }
    expect(await listConflictedDrafts('p1')).toHaveLength(1);
    expect((await listConflictedDrafts('p1'))[0].id).toBe(first.id);
    expect(await listConflictedDrafts('p2')).toHaveLength(10);
  });

  it('删除单条归档', async () => {
    const entry = await putConflictedDraft('p1', makeRecord('p1', '2026-09-23T01:00:00'));
    await deleteConflictedDraft(entry.id);
    expect(await listConflictedDrafts('p1')).toHaveLength(0);
  });
});
