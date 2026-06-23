import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TTSSynthesis } from '../TTSSynthesis';

const mockProject = vi.hoisted(() => {
  const now = '2026-01-01T00:00:00.000Z';
  const chapter = {
    id: 'chapter-1',
    name: '第一章',
    segments: [],
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
    default_narrator_snapshot: null,
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
    adoptBackendVersion: vi.fn().mockResolvedValue(undefined),
    clearDraft: vi.fn().mockResolvedValue(undefined),
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
    synthesize: vi.fn(),
    getEdgeVoices: vi.fn().mockResolvedValue([]),
    getEdgeLanguages: vi.fn().mockResolvedValue([]),
  },
  mimoTtsApi: { synthesizePreset: vi.fn(), synthesizeVoiceClone: vi.fn() },
  voxcpmApi: { design: vi.fn(), clone: vi.fn(), ultimateClone: vi.fn(), tts: vi.fn() },
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

vi.mock('../../services/audioTrim', () => ({ trimBase64AudioSilence: vi.fn() }));

vi.mock('../../components/TTSSynthesis/GlobalControlBar', () => ({
  GlobalControlBar: () => <div data-testid="global-control-bar" />,
}));
vi.mock('../../components/TTSSynthesis/EdgeTTSPanel', () => ({
  EdgeTTSPanel: () => <div data-testid="edge-tts-panel" />,
}));
vi.mock('../../components/TTSSynthesis/MiMoTTSPanel', () => ({
  MiMoTTSPanel: () => <div data-testid="mimo-tts-panel" />,
}));
vi.mock('../../components/TTSSynthesis/VoxCPMPanel', () => ({
  VoxCPMPanel: () => <div data-testid="voxcpm-panel" />,
}));

vi.mock('../../components/VoiceStudio/VoiceStudioLayout', () => ({
  VoiceStudioLayout: ({ children, viewMode, onViewModeChange, onBatchSynthesize, onExport, onPlayAll }: {
    children: React.ReactNode;
    viewMode: 'list' | 'dialogue';
    onViewModeChange: (mode: 'list' | 'dialogue') => void;
    onBatchSynthesize: () => void;
    onExport: () => void;
    onPlayAll: () => void;
  }) => (
    <section data-testid="voice-studio-layout">
      <h2>Voice Studio</h2>
      <button type="button" aria-pressed={viewMode === 'list'} onClick={() => onViewModeChange('list')}>列表视图</button>
      <button type="button" aria-pressed={viewMode === 'dialogue'} onClick={() => onViewModeChange('dialogue')}>对话视图</button>
      <button type="button" onClick={onBatchSynthesize}>批量合成</button>
      <button type="button" onClick={onPlayAll}>全部播放</button>
      <button type="button" onClick={onExport}>导出</button>
      {children}
    </section>
  ),
}));

describe('TTSSynthesis Studio chrome', () => {
  it('lets VoiceStudioLayout own the title and list/dialogue switch without legacy duplicates', async () => {
    render(<TTSSynthesis hideProjectSidebar />);

    await waitFor(() => expect(screen.getByTestId('voice-studio-layout')).toBeInTheDocument());

    expect(screen.queryByText('分段配音工作台')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '列表视图' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: '对话视图' })).toHaveLength(1);
    expect(screen.getByRole('button', { name: '批量合成' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /全部播放/ })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: /导出/ })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /全部生成/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /角色库/ })).toBeInTheDocument();
    expect(screen.getByTestId('edge-tts-panel')).toBeInTheDocument();
  });
});
