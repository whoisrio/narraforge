import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { TTSSynthesis } from '../TTSSynthesis';
import { TranslationProvider } from '../../i18n';
import { getDraft, putDraft, listDrafts, deleteDraft, type ProjectDraftRecord } from '../../services/segmentedDraftStore';
import { listConflictedDrafts, clearConflictedDrafts } from '../../services/conflictedDraftStore';
import type { SegmentedProject } from '../../types';

// 409 草稿保护主链路（spec：docs/plans/2026-09-23-segmented-save-conflict-recovery-design.md §6）：
//   A. 加载期冲突 → 用草稿 = force save 真正落库
//   B. 加载期冲突 → 用后端 = adopt + 被放弃草稿归档 → 工作室工具栏找回 → 恢复再裁决
//   C/D. 编辑自动保存走细粒度 PATCH，不再发整包 PUT（项目级乐观锁冲突退出热路径）
// 假冲突自愈（第一层）由 useSegmentedDraftSync 单测覆盖；e2e 覆盖浏览器全链路。

const saveMock = vi.hoisted(() => vi.fn());
const getProjectMock = vi.hoisted(() => vi.fn());
const listProjectsMock = vi.hoisted(() => vi.fn());
const patchChapterMock = vi.hoisted(() => vi.fn());
const patchProjectMock = vi.hoisted(() => vi.fn());
const putSourceDocumentMock = vi.hoisted(() => vi.fn());
const putNarrationScriptMock = vi.hoisted(() => vi.fn());

vi.mock('../../hooks/useStorageMode', () => ({
  useStorageMode: () => ({ mode: 'backend', setMode: vi.fn(), loading: false }),
}));

vi.mock('../../hooks/useVoiceRefresh', () => ({
  useVoiceRefresh: () => ({ refreshCounter: 0, refreshVoices: vi.fn() }),
}));

// 保留真实的 apiErrorCode / apiStaleServerUpdatedAt（draftSync 自愈判定用），只 mock 网络端 API
vi.mock('../../services/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/api')>();
  return {
    ...actual,
    segmentedProjectApi: {
      ...actual.segmentedProjectApi,
      patchChapter: patchChapterMock,
      patchProject: patchProjectMock,
      putSourceDocument: putSourceDocumentMock,
      putNarrationScript: putNarrationScriptMock,
    },
    textSplitApi: { llmSplit: vi.fn() },
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
    saveProject: saveMock,
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

const T0 = '2026-09-23T00:30:00';
const T1 = '2026-09-23T01:00:00';
const T2 = '2026-09-23T02:00:00'; // 服务端权威版本（后端被外部推进后）
const T3 = '2026-09-23T03:00:00'; // force save 后服务端响应版本

function makeBackendProject(): SegmentedProject {
  const now = '2026-09-23T00:00:00.000Z';
  const seg = {
    id: 'seg-1', text: '第一句。', voice: { source: 'chapter' }, status: 'idle',
    audio: { format: 'mp3' }, role_id: null, segment_kind: 'narration',
    created_at: now, updated_at: now,
  };
  const chapter = {
    id: 'ch-1', name: '第一章', segments: [seg],
    voice: { engine: 'edge_tts' as const, voice: '', rate: '+0%', volume: '+0%' },
    split_config: { delimiters: ['。'], mode: 'rule' as const },
    created_at: now, updated_at: T2,
  };
  return {
    schema_version: 2 as const, id: 'p-conflict', name: 'backend-name', layout: 'vertical' as const,
    chapters: [chapter], active_chapter_id: chapter.id,
    created_at: now, updated_at: T2,
  };
}

function makeDraftProject(): SegmentedProject {
  // 本地未保存编辑：项目名与章节名都不同于后端权威态
  const p = makeBackendProject();
  return { ...p, name: 'draft-name', updated_at: T1, chapters: [{ ...p.chapters[0], name: '第一章·本地改' }] };
}

/** 预置一份 dirty + 过期 base 的本地草稿（模拟用户有未保存编辑，服务端已被他方推进）。 */
async function seedConflictDraft(): Promise<void> {
  const rec: ProjectDraftRecord = {
    project_id: 'p-conflict',
    draft: makeDraftProject(),
    base_updated_at: T0, // 服务端 T2 - base > 2s 容差 → 加载期真冲突
    updated_at: T1,
    dirty: true,
  };
  await putDraft(rec);
}

function renderPage() {
  return render(
    <TranslationProvider>
      <TTSSynthesis hideProjectSidebar />
    </TranslationProvider>,
  );
}

/** 等待干净加载收敛：后端项目已 adopt（草稿记录建立且 base=T2）。

初始 scratchpad 项目也自带「第一章」章节，交互若抢在 LOAD_PROJECT 落地前，
会点到即将被替换的旧 DOM（点击丢失 / 编辑态被重置）——先等加载收敛再操作。
这是该文件曾偶发「重命名点击无效」的根因（timing race，非产品缺陷）。 */
async function waitForCleanLoad(): Promise<void> {
  await waitFor(async () => {
    const rec = await getDraft('p-conflict');
    expect(rec?.base_updated_at).toBe(T2);
    expect(rec?.dirty).toBe(false);
  }, { timeout: 10_000 });
}

beforeEach(async () => {
  for (const d of await listDrafts()) await deleteDraft(d.project_id);
  await clearConflictedDrafts();
  saveMock.mockReset();
  saveMock.mockImplementation(async (project: SegmentedProject) => ({ ...project, updated_at: T3 }));
  getProjectMock.mockReset();
  getProjectMock.mockResolvedValue(makeBackendProject());
  patchChapterMock.mockReset();
  patchChapterMock.mockImplementation(async () => ({ chapter: makeBackendProject().chapters[0], project_updated_at: T3 }));
  patchProjectMock.mockReset();
  patchProjectMock.mockImplementation(async () => ({ ...makeBackendProject(), updated_at: T3 }));
  putSourceDocumentMock.mockReset();
  putSourceDocumentMock.mockResolvedValue({ path: 'source.md', project_updated_at: T3 });
  putNarrationScriptMock.mockReset();
  putNarrationScriptMock.mockResolvedValue({ path: 'narration.md', project_updated_at: T3 });
  listProjectsMock.mockReset();
  listProjectsMock.mockResolvedValue([
    { id: 'p-conflict', name: 'backend-name', schema_version: 2, layout: 'vertical', chapters: [], created_at: '2026-09-23T00:00:00', updated_at: T2 },
  ]);
});

describe('TTSSynthesis 409 真冲突裁决（第二层）', () => {
  it('A. 加载期冲突选「用草稿」→ force save 真正落库（不带 base），草稿记录以服务端版本收尾', async () => {
    await seedConflictDraft();
    renderPage();

    // 加载即检测到冲突：模态裁决窗
    const dialog = await screen.findByRole('alertdialog', {}, { timeout: 10_000 });
    expect(dialog.textContent).toContain('检测到版本冲突');
    expect(dialog.textContent).toContain('本地草稿已自动归档');

    fireEvent.click(screen.getByRole('button', { name: '恢复本地草稿' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull(), { timeout: 5_000 });

    // force save：不携带 base（后端 None=放行），且内容是用户选择的草稿
    expect(saveMock).toHaveBeenCalledTimes(1);
    const [savedProject, options] = saveMock.mock.calls[0];
    expect(savedProject.name).toBe('draft-name');
    expect(savedProject.chapters[0].name).toBe('第一章·本地改');
    expect(options).toEqual({ base_updated_at: null });

    // 草稿记录以服务端响应版本收尾：base=T3、dirty=false（autosave 恢复，无 409 循环）
    const rec = await getDraft('p-conflict');
    expect(rec?.dirty).toBe(false);
    expect(rec?.base_updated_at).toBe(T3);
    expect(rec?.draft.name).toBe('draft-name');
  }, 20_000);

  it('B. 加载期冲突选「用后端」→ adopt 权威态、被放弃草稿归档；工作室工具栏可找回并再次裁决', async () => {
    await seedConflictDraft();
    renderPage();

    await screen.findByRole('alertdialog', {}, { timeout: 10_000 });
    fireEvent.click(screen.getByRole('button', { name: '使用后端版本' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull(), { timeout: 5_000 });

    // 不做 force save；草稿记录被后端权威态取代
    expect(saveMock).not.toHaveBeenCalled();
    const rec = await getDraft('p-conflict');
    expect(rec?.draft.name).toBe('backend-name');
    expect(rec?.dirty).toBe(false);
    expect(rec?.base_updated_at).toBe(T2);

    // 被放弃的草稿已归档（加载期路径由 resolveConflict 补归档）
    const archived = await listConflictedDrafts('p-conflict');
    expect(archived).toHaveLength(1);
    expect(archived[0].record.draft.name).toBe('draft-name');

    // 工作室工具栏出现「冲突草稿 (1)」入口 → 打开归档对话框
    fireEvent.click(await screen.findByRole('button', { name: /工作室/ }, { timeout: 10_000 }));
    fireEvent.click(await screen.findByRole('button', { name: '冲突草稿 (1)' }, { timeout: 10_000 }));
    const archiveDialog = await screen.findByRole('alertdialog');
    expect(archiveDialog.textContent).toContain('冲突草稿归档');
    expect(archiveDialog.textContent).toContain('draft-name'.length > 0 ? '归档于' : '');

    // 恢复归档 → 拉当前后端态 → 再次进入裁决弹窗（backend vs 归档草稿）
    fireEvent.click(screen.getByRole('button', { name: '恢复此草稿' }));
    const conflictDialog = await screen.findByRole('alertdialog', {}, { timeout: 10_000 });
    expect(conflictDialog.textContent).toContain('检测到版本冲突');

    // 再裁决：用草稿 → force save 落库的是归档的草稿内容
    fireEvent.click(screen.getByRole('button', { name: '恢复本地草稿' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull(), { timeout: 5_000 });
    expect(saveMock).toHaveBeenCalledTimes(1);
    expect(saveMock.mock.calls[0][0].name).toBe('draft-name');
    expect(saveMock.mock.calls[0][1]).toEqual({ base_updated_at: null });
  }, 30_000);

  it('C. 章节改名走 chapter PATCH：不发整包 PUT，不弹冲突窗', async () => {
    renderPage();
    await waitForCleanLoad();

    fireEvent.click(await screen.findByRole('button', { name: /文本库/ }, { timeout: 10_000 }));
    fireEvent.click(await screen.findByRole('button', { name: '章节', exact: true }));
    fireEvent.click(await screen.findByRole('button', { name: /重命名章节 第一章/ }));
    const titleInput = await screen.findByLabelText('章节标题');
    fireEvent.change(titleInput, { target: { value: '第一章·细粒度保存' } });
    fireEvent.keyDown(titleInput, { key: 'Enter' });

    await waitFor(() => expect(patchChapterMock).toHaveBeenCalledWith(
      'p-conflict', 'ch-1', { name: '第一章·细粒度保存' },
    ), { timeout: 5_000 });

    // 整包 PUT 已退出自动保存热路径：不会再有项目级乐观锁 409。
    expect(saveMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).toBeNull();

    // 服务端版本经 noteServerVersion 推进到 patch 响应，草稿保持干净。
    await waitFor(async () => {
      const rec = await getDraft('p-conflict');
      expect(rec?.base_updated_at).toBe(T3);
      expect(rec?.dirty).toBe(false);
    });
  }, 20_000);

  it('D. 干净加载后的项目改名走 project PATCH，携带完整 configs 且不发整包 PUT', async () => {
    renderPage();
    await waitForCleanLoad();

    fireEvent.click(await screen.findByRole('button', { name: /设置/ }, { timeout: 10_000 }));
    const nameInput = await screen.findByLabelText('项目名称');
    fireEvent.change(nameInput, { target: { value: '细粒度项目名' } });

    await waitFor(() => expect(patchProjectMock).toHaveBeenCalledWith(
      'p-conflict', { name: '细粒度项目名' },
    ), { timeout: 5_000 });
    expect(saveMock).not.toHaveBeenCalled();
  }, 20_000);
});
