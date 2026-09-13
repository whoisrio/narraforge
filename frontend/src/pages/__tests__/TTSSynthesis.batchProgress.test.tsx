import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TTSSynthesis } from '../TTSSynthesis';

// 本章节批量合成：确认后 contextBar 常显进度条（复用 produce-all 的渲染位），
// 且提供「停止」入口——停止后已合成段保留、剩余段不再发起合成。

const synthesizeMock = vi.hoisted(() => vi.fn());

const mockProject = vi.hoisted(() => {
  const now = '2026-01-01T00:00:00.000Z';
  const makeSeg = (id: string, text: string) => ({
    id,
    text,
    voice: { source: 'chapter' },
    status: 'idle',
    audio: { format: 'mp3' },
    role_id: null,
    segment_kind: 'narration',
    created_at: now,
    updated_at: now,
  });
  const chapter = {
    id: 'chapter-1',
    name: '第一章',
    segments: [makeSeg('seg-1', '第一句。'), makeSeg('seg-2', '第二句。')],
    default_params: { engine: 'edge_tts' as const },
    split_config: { delimiters: ['，', '。', '！', '？'], mode: 'rule' as const },
    created_at: now,
    updated_at: now,
  };
  return {
    schema_version: 2 as const,
    id: '__scratchpad__',
    name: '草稿项目',
    chapters: [chapter],
    active_chapter_id: chapter.id,
    layout: 'vertical' as const,
    remotion_project_path: null,
    default_narrator_role_id: null,
    created_at: now,
    updated_at: now,
  };
});

vi.mock('../../hooks/useStorageMode', () => ({
  useStorageMode: () => ({ mode: 'frontend', setMode: vi.fn(), loading: false }),
}));

vi.mock('../../hooks/useVoiceRefresh', () => ({
  useVoiceRefresh: () => ({ refreshCounter: 0, refreshVoices: vi.fn() }),
}));

vi.mock('../../hooks/useSegmentedDraftSync', () => ({
  useSegmentedDraftSync: () => ({
    markDirty: vi.fn().mockResolvedValue(undefined),
    flush: vi.fn().mockResolvedValue(undefined),
    adoptBackendVersion: vi.fn().mockResolvedValue(undefined),
    clearDraft: vi.fn().mockResolvedValue(undefined),
    noteServerVersion: vi.fn().mockResolvedValue(undefined),
    refreshDraft: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('../../services/segmentedDraftStore', () => ({
  getDraft: vi.fn().mockResolvedValue(null),
  deleteDraft: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../services/segmentedProjectStorage', () => ({
  indexedDBStorage: {
    listProjects: vi.fn().mockResolvedValue([mockProject]),
    getProject: vi.fn().mockResolvedValue(mockProject),
    saveProject: vi.fn().mockResolvedValue(undefined),
    deleteProject: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../services/backendSegmentedProjectStorage', () => ({
  backendStorage: {
    listProjects: vi.fn().mockResolvedValue([]),
    getProject: vi.fn().mockResolvedValue(null),
    saveProject: vi.fn().mockResolvedValue(undefined),
    deleteProject: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../services/api', () => ({
  textSplitApi: { llmSplit: vi.fn() },
  ttsApi: {
    getVoices: vi.fn().mockResolvedValue([]),
    synthesize: synthesizeMock,
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
}));

vi.mock('../../services/indexedDB', () => ({
  saveTTSResult: vi.fn(),
  deleteTTSResult: vi.fn(),
  getTTSAudioBlob: vi.fn(),
}));

vi.mock('../../services/audioTrim', () => ({
  trimBase64AudioSilence: vi.fn().mockResolvedValue({ base64: '', trimmedMs: 0 }),
}));

class FakeAudioContext {
  async decodeAudioData() { return { duration: 1.5 }; }
  async close() { /* noop */ }
}
vi.stubGlobal('AudioContext', FakeAudioContext);

afterEach(() => {
  synthesizeMock.mockReset();
});

describe('TTSSynthesis 本章节批量合成进度', () => {
  it('确认后常显进度条，停止后不再合成剩余段', async () => {
    let resolveSynth: ((value: { audio_base64: string; audio_format: string }) => void) | undefined;
    synthesizeMock.mockImplementation(
      () => new Promise((resolve) => { resolveSynth = resolve; }),
    );

    render(<TTSSynthesis hideProjectSidebar />);

    // 进入工作室
    const studioButton = await screen.findByRole('button', { name: /工作室/ });
    fireEvent.click(studioButton);

    // 批量合成 → 仅合成未合成 → 确认
    const batchButton = await screen.findByRole('button', { name: /批量合成/ });
    fireEvent.click(batchButton);
    fireEvent.click(await screen.findByRole('button', { name: /仅合成未合成/ }));
    fireEvent.click(await screen.findByRole('button', { name: '生成' }));

    // 进度条常显：0/2 + 停止入口
    const progress = await screen.findByTestId('produce-all-progress');
    expect(progress).toHaveTextContent('合成中 0/2');
    const stopButton = screen.getByTestId('produce-all-stop');

    // 第一段合成挂起时点击停止，再放行第一段
    fireEvent.click(stopButton);
    resolveSynth?.({ audio_base64: btoa('audio'), audio_format: 'mp3' });

    // 停止生效：只发起了一段合成，进度条消失
    await waitFor(() => expect(screen.queryByTestId('produce-all-progress')).not.toBeInTheDocument());
    expect(synthesizeMock).toHaveBeenCalledTimes(1);
  });

  it('无停止操作跑完全部段', async () => {
    // 合成立即完成时进度条可能在同一渲染批次内出现并消失，这里只断言最终行为
    synthesizeMock.mockResolvedValue({ audio_base64: btoa('audio'), audio_format: 'mp3' });

    render(<TTSSynthesis hideProjectSidebar />);
    fireEvent.click(await screen.findByRole('button', { name: /工作室/ }));
    fireEvent.click(await screen.findByRole('button', { name: /批量合成/ }));
    fireEvent.click(await screen.findByRole('button', { name: /仅合成未合成/ }));
    fireEvent.click(await screen.findByRole('button', { name: '生成' }));

    await waitFor(() => expect(synthesizeMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByTestId('produce-all-progress')).not.toBeInTheDocument());
  });
});
