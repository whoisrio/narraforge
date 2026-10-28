import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TTSSynthesis } from '../TTSSynthesis';
import { TranslationProvider } from '../../i18n';

// 重新合成期间旧音频必须保持可播放：TTS 状态（pending/queued）不得阻塞播放，
// 也不得在开始批量合成时删除/清空旧音频。

const synthesizeMock = vi.hoisted(() => vi.fn());
const getTTSAudioBlobMock = vi.hoisted(() => vi.fn());
const deleteTTSResultMock = vi.hoisted(() => vi.fn());

const mockProject = vi.hoisted(() => {
  const now = '2026-01-01T00:00:00.000Z';
  const chapter = {
    id: 'chapter-1',
    name: '第一章',
    segments: [{
      id: 'seg-1',
      text: '已经生成过的第一句。',
      voice: { source: 'chapter' },
      status: 'ready',
      audio: { format: 'mp3', current: { id: 'audio-1', duration_sec: 1.5 }, duration_sec: 1.5 },
      role_id: null,
      segment_kind: 'narration',
      created_at: now,
      updated_at: now,
    }, {
      id: 'seg-2',
      text: '已经生成过的第二句。',
      voice: { source: 'chapter' },
      status: 'ready',
      audio: { format: 'mp3', current: { id: 'audio-2', duration_sec: 1.5 }, duration_sec: 1.5 },
      role_id: null,
      segment_kind: 'narration',
      created_at: now,
      updated_at: now,
    }],
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
    noteServerVersion: vi.fn().mockResolvedValue(undefined),
    refreshDraft: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn(),
    resume: vi.fn(),
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
  deleteTTSResult: deleteTTSResultMock,
  getTTSAudioBlob: getTTSAudioBlobMock,
}));

vi.mock('../../services/audioTrim', () => ({
  trimBase64AudioSilence: vi.fn().mockResolvedValue({ base64: '', trimmedMs: 0 }),
}));

class FakeAudioContext {
  async decodeAudioData() { return { duration: 1.5 }; }
  async close() { /* noop */ }
}
vi.stubGlobal('AudioContext', FakeAudioContext);

describe('TTSSynthesis 重新合成期间的播放', () => {
  let resolveSynth: ((value: { audio_base64: string; audio_format: string }) => void) | undefined;

  beforeEach(() => {
    resolveSynth = undefined;
    synthesizeMock.mockReset();
    synthesizeMock.mockImplementation(() => new Promise((resolve) => { resolveSynth = resolve; }));
    getTTSAudioBlobMock.mockReset();
    getTTSAudioBlobMock.mockResolvedValue(new Blob(['old-audio'], { type: 'audio/mpeg' }));
    deleteTTSResultMock.mockReset();
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('重新合成 A 段时，A 段进入合成中且 B 段仍可播放', async () => {
    render(
      <TranslationProvider>
        <TTSSynthesis hideProjectSidebar />
      </TranslationProvider>,
    );

    fireEvent.click(await screen.findByRole('button', { name: /工作室/ }));

    await waitFor(() => {
      expect(document.querySelectorAll('[data-segment-id]')).toHaveLength(2);
    });

    // 展开 A 段编辑面板：点击行内文本即可选中该段。
    const rowA = document.querySelector('[data-segment-id="seg-1"]') as HTMLElement;
    fireEvent.click(within(rowA).getByText('已经生成过的第一句。'));

    fireEvent.click(await screen.findByRole('button', { name: '重新生成' }));
    await waitFor(() => expect(synthesizeMock).toHaveBeenCalledTimes(1));

    // A 段进入 pending：播放按钮让位给「合成中」状态。
    await waitFor(() => {
      const a = document.querySelector('[data-segment-id="seg-1"]') as HTMLElement;
      expect(within(a).queryByTitle('播放')).toBeNull();
      expect(within(a).getByTitle('合成中...')).toBeTruthy();
    });

    // B 段已经完成过 TTS，不受 A 段合成影响，仍可播放。
    const rowB = document.querySelector('[data-segment-id="seg-2"]') as HTMLElement;
    fireEvent.click(within(rowB).getByTitle('播放'));

    await waitFor(() => expect(getTTSAudioBlobMock).toHaveBeenCalledWith('audio-2'));
    expect(deleteTTSResultMock).not.toHaveBeenCalled();

    resolveSynth?.({ audio_base64: btoa('new-audio'), audio_format: 'mp3' });
    await waitFor(() => expect(synthesizeMock).toHaveBeenCalledTimes(1));
  });
});
