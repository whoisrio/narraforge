import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { TTSSynthesis } from '../TTSSynthesis';
import { TranslationProvider } from '../../i18n';
import { deleteDraft, getDraft, listDrafts } from '../../services/segmentedDraftStore';
import type { SegmentedProject } from '../../types';

// 重新拆分必须把"拆分后的段结构 + 每段元数据"一次写进 structure 端点。
// 回归点：曾从拆分前的 next 取章节，导致服务端收到旧段结构（本地已拆、刷新又变回去）。

const getProjectMock = vi.hoisted(() => vi.fn());
const listProjectsMock = vi.hoisted(() => vi.fn());
const reconcileMock = vi.hoisted(() => vi.fn());
const ruleSplitMock = vi.hoisted(() => vi.fn());
const patchChapterMock = vi.hoisted(() => vi.fn());

const SOURCE_TEXT = '第一句。第二句。';

function makeBackendProject(): SegmentedProject {
  const now = '2026-09-23T00:00:00.000Z';
  const chapter = {
    id: 'ch-1',
    name: '第一章',
    original_text: SOURCE_TEXT,
    segments: [{
      id: 'seg-old',
      text: SOURCE_TEXT,
      voice: { source: 'role' as const, role_id: 'role-1' },
      role_id: 'role-1',
      segment_kind: 'dialogue' as const,
      emotion: 'happy' as const,
      status: 'idle' as const,
      audio: { format: 'mp3' },
      created_at: now,
      updated_at: now,
    }],
    voice: { engine: 'edge_tts' as const, voice: '', rate: '+0%', volume: '+0%' },
    split_config: { delimiters: ['。'], mode: 'rule' as const },
    created_at: now,
    updated_at: now,
  };
  return {
    schema_version: 2,
    id: 'p-split',
    name: '拆分项目',
    layout: 'vertical',
    chapters: [chapter],
    active_chapter_id: chapter.id,
    created_at: now,
    updated_at: now,
  };
}

vi.mock('../../hooks/useStorageMode', () => ({
  useStorageMode: () => ({ mode: 'backend', setMode: vi.fn(), loading: false }),
}));

vi.mock('../../hooks/useVoiceRefresh', () => ({
  useVoiceRefresh: () => ({ refreshCounter: 0, refreshVoices: vi.fn() }),
}));

vi.mock('../../services/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/api')>();
  return {
    ...actual,
    segmentedProjectApi: {
      ...actual.segmentedProjectApi,
      reconcileChapterStructure: reconcileMock,
      patchChapter: patchChapterMock,
    },
    textSplitApi: { ...actual.textSplitApi, ruleSplit: ruleSplitMock },
    ttsApi: {
      getVoices: vi.fn().mockResolvedValue([]),
      synthesize: vi.fn(),
      getEdgeVoices: vi.fn().mockResolvedValue([]),
      getEdgeLanguages: vi.fn().mockResolvedValue([]),
    },
    mimoTtsApi: { synthesizePreset: vi.fn(), synthesizeVoiceClone: vi.fn() },
    voxcpmApi: { design: vi.fn(), clone: vi.fn(), ultimateClone: vi.fn(), tts: vi.fn() },
    indexttsApi: { tts: vi.fn(), getStatus: vi.fn(), loadModel: vi.fn(), unloadModel: vi.fn() },
    roleApi: {
      listRoles: vi.fn().mockResolvedValue([]),
      createRole: vi.fn(),
      updateRole: vi.fn(),
      deleteRole: vi.fn(),
    },
  };
});

vi.mock('../../services/backendSegmentedProjectStorage', () => ({
  backendStorage: {
    listProjects: listProjectsMock,
    getProject: getProjectMock,
    saveProject: vi.fn(),
    deleteProject: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../services/segmentedProjectStorage', () => ({
  indexedDBStorage: {
    listProjects: vi.fn().mockResolvedValue([]),
    getProject: vi.fn().mockResolvedValue(undefined),
    saveProject: vi.fn().mockResolvedValue(undefined),
    deleteProject: vi.fn().mockResolvedValue(undefined),
  },
}));

class FakeAudioContext {
  async decodeAudioData() { return { duration: 1.5 }; }
  async close() { /* noop */ }
}
vi.stubGlobal('AudioContext', FakeAudioContext);

function renderPage() {
  return render(
    <TranslationProvider>
      <TTSSynthesis hideProjectSidebar />
    </TranslationProvider>,
  );
}

beforeEach(async () => {
  for (const d of await listDrafts()) await deleteDraft(d.project_id);
  getProjectMock.mockReset();
  getProjectMock.mockResolvedValue(makeBackendProject());
  listProjectsMock.mockReset();
  listProjectsMock.mockResolvedValue([
    { id: 'p-split', name: '拆分项目', schema_version: 2, layout: 'vertical', chapters: [], created_at: '', updated_at: '' },
  ]);
  ruleSplitMock.mockReset();
  ruleSplitMock.mockResolvedValue(['第一句。', '第二句。']);
  reconcileMock.mockReset();
  reconcileMock.mockImplementation(async (_projectId, chapterId, segments) => ({
    segments: segments.map((s: { id: string; text: string; position: number }) => ({
      ...s,
      emotion: null,
      role_id: null,
      segment_kind: 'narration',
      voice: { source: 'chapter' },
    })),
    project_updated_at: '2026-09-23T00:10:00',
  }));
  patchChapterMock.mockReset();
  patchChapterMock.mockResolvedValue({
    chapter: makeBackendProject().chapters[0],
    project_updated_at: '2026-09-23T00:10:00',
  });
});

describe('TTSSynthesis 重新拆分的结构持久化', () => {
  it('structure 请求携带拆分后的新段与元数据，而不是拆分前的旧结构', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /工作室/ }, { timeout: 10_000 }));
    // 初始 scratchpad 也会渲染同一个工作台：等后端项目真正 adopt 完再操作。
    await waitFor(async () => {
      const rec = await getDraft('p-split');
      expect(rec?.dirty).toBe(false);
      expect(rec?.base_updated_at).toBe(makeBackendProject().updated_at);
    }, { timeout: 10_000 });

    fireEvent.click(await screen.findByRole('button', { name: 'SMART SEGMENT' }, { timeout: 10_000 }));

    await waitFor(() => expect(reconcileMock).toHaveBeenCalledTimes(1), { timeout: 5_000 });
    const [projectId, chapterId, payload] = reconcileMock.mock.calls[0];
    expect(projectId).toBe('p-split');
    expect(chapterId).toBe('ch-1');
    expect(payload.map((s: { text: string }) => s.text)).toEqual(['第一句。', '第二句。']);
    expect(payload.map((s: { position: number }) => s.position)).toEqual([0, 1]);
    // 每个段都显式带元数据字段，避免服务端行落回默认值。
    for (const seg of payload) {
      expect(seg).toHaveProperty('emotion');
      expect(seg).toHaveProperty('role_id');
      expect(seg).toHaveProperty('segment_kind');
      expect(seg).toHaveProperty('voice');
    }
  }, 20_000);
});
