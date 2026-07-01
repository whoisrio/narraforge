import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Role, EngineParams, RoleSnapshot } from '../../types';
import { ProjectVoices } from './ProjectVoices';
import { normalizeDraftForSave } from './ProjectVoices';

// Mock API modules
vi.mock('../../services/api', () => ({
  ttsApi: {
    getVoices: vi.fn().mockResolvedValue([]),
    getEdgeVoices: vi.fn().mockResolvedValue([]),
    synthesize: vi.fn(),
  },
  voiceApi: {
    list: vi.fn().mockResolvedValue([]),
    savePreviewAudio: vi.fn(),
    createFromDesign: vi.fn().mockResolvedValue({ id: 'new-profile-id' }),
  },
  mimoTtsApi: {
    synthesizeVoiceClone: vi.fn(),
    synthesizePreset: vi.fn(),
    synthesizeVoiceDesign: vi.fn(),
    getPresetVoices: vi.fn().mockResolvedValue([]),
  },
  voxcpmApi: {
    clone: vi.fn(),
  },
}));

vi.mock('../../services/voiceRolePreview', () => ({
  fetchVoiceRolePreview: vi.fn().mockResolvedValue({
    audio_base64: btoa('fake-audio-data'),
    audio_format: 'mp3',
  }),
  synthesizeVoiceRolePreview: vi.fn(),
  playVoiceRolePreview: vi.fn(),
}));

vi.mock('../../hooks/useVoiceRefresh', () => ({
  useVoiceRefresh: () => ({ triggerRefresh: vi.fn(), refreshKey: 0 }),
}));

const edgeVoice: EngineParams = { engine: 'edge_tts', voice: 'zh-CN-YunxiNeural', rate: '+0%', volume: '+0%' };
const edgeVoice2: EngineParams = { engine: 'edge_tts', voice: 'zh-CN-YunyangNeural', rate: '+0%', volume: '+0%' };

const narrator: Role = {
  id: 'role-narrator',
  name: '默认旁白',
  description: 'Narrator',
  voice: edgeVoice,
  favorite_styles: [],
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

const cast: Role = {
  id: 'role-guest-a',
  name: '嘉宾A',
  description: 'Cast',
  voice: edgeVoice2,
  favorite_styles: [],
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

describe('ProjectVoices', () => {
  it('renders role cards with name, identity chip, and engine chip', () => {
    render(
      <ProjectVoices
        roles={[narrator, cast]}
        onPreviewRole={vi.fn()}
        onManageRoles={vi.fn()}
      />,
    );

    expect(screen.getByText('默认旁白')).toBeInTheDocument();
    expect(screen.getByText('嘉宾A')).toBeInTheDocument();
    // All roles show "角色" chip
    const roleChips = screen.getAllByText('角色');
    expect(roleChips.length).toBeGreaterThan(0);
    // Engine chips
    expect(screen.getAllByText('Edge-TTS').length).toBeGreaterThan(0);
    // Preview buttons
    expect(screen.getAllByRole('button', { name: /试听/ })).toHaveLength(2);
  });

  it('shows empty state when no roles exist', () => {
    render(
      <ProjectVoices
        roles={[]}
        onPreviewRole={vi.fn()}
        onManageRoles={vi.fn()}
      />,
    );

    expect(screen.getByText('还没有角色')).toBeInTheDocument();
  });

  it('shows placeholder card for adding new role', () => {
    render(
      <ProjectVoices
        roles={[narrator]}
        onPreviewRole={vi.fn()}
        onManageRoles={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: /创建角色/ })).toBeInTheDocument();
  });

  it('opens editor when clicking a role card', () => {
    render(
      <ProjectVoices
        roles={[narrator]}
        onPreviewRole={vi.fn()}
        onManageRoles={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /编辑 默认旁白/ }));

    expect(screen.getByLabelText('声音角色编辑器')).toBeInTheDocument();
    expect(screen.getByLabelText('角色名')).toHaveValue('默认旁白');
    expect(screen.getByText('音色来源')).toBeInTheDocument();
  });

  it('opens editor for new role via placeholder card', () => {
    render(
      <ProjectVoices
        roles={[cast]}
        onPreviewRole={vi.fn()}
        onManageRoles={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /创建角色/ }));

    expect(screen.getByLabelText('声音角色编辑器')).toBeInTheDocument();
    expect(screen.getByLabelText('角色名')).toHaveValue('新角色');
  });

  it('cancels editing and closes editor', () => {
    render(
      <ProjectVoices
        roles={[narrator]}
        onPreviewRole={vi.fn()}
        onManageRoles={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /编辑 默认旁白/ }));
    expect(screen.getByLabelText('声音角色编辑器')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /取消/ }));
    expect(screen.queryByLabelText('声音角色编辑器')).not.toBeInTheDocument();
  });

  it('deletes role from card', () => {
    const onDeleteRole = vi.fn();

    render(
      <ProjectVoices
        roles={[narrator, cast]}
        onDeleteRole={onDeleteRole}
        onPreviewRole={vi.fn()}
        onManageRoles={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '删除 嘉宾A' }));

    expect(onDeleteRole).toHaveBeenCalledWith('role-guest-a');
  });

  it('filters roles by engine', () => {
    const cosyRole: Role = {
      ...cast,
      id: 'role-cosy',
      name: 'Cosy角色',
      voice: { engine: 'cosyvoice', voice_id: 'voice-123' },
    };

    render(
      <ProjectVoices
        roles={[narrator, cosyRole]}
        onPreviewRole={vi.fn()}
        onManageRoles={vi.fn()}
      />,
    );

    // Both visible initially
    expect(screen.getByText('默认旁白')).toBeInTheDocument();
    expect(screen.getByText('Cosy角色')).toBeInTheDocument();

    // Filter to CosyVoice only
    fireEvent.change(screen.getByDisplayValue('全部引擎'), { target: { value: 'cosyvoice' } });

    expect(screen.queryByText('默认旁白')).not.toBeInTheDocument();
    expect(screen.getByText('Cosy角色')).toBeInTheDocument();
  });
});

describe('ProjectVoices – clone preview validation', () => {
  const cloneRole: Role = {
    id: 'role-clone-1',
    name: '克隆角色',
    voice: { engine: 'mimo_tts', mode: 'voiceclone', voice_id: 'voice-abc' },
    favorite_styles: [],
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };

  it('blocks save when clone preview has not been generated', async () => {
    const onSaveRole = vi.fn();
    const { ttsApi } = await import('../../services/api');
    // Voice profile loaded by useEffect has no cloned_preview_url
    (ttsApi.getVoices as ReturnType<typeof vi.fn>).mockResolvedValue([{
      id: 'voice-abc',
      name: 'cloned voice',
      audio_url: '',
      source_audio_url: '',
      cloned_preview_url: '',
      engine: { type: 'mimo', is_cloned: true },
      engine_params: {},
      created_at: '2026-01-01T00:00:00.000Z',
    }]);

    render(
      <ProjectVoices
        roles={[cloneRole]}
        onSaveRole={onSaveRole}
        onPreviewRole={vi.fn()}
        onManageRoles={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /编辑 克隆角色/ }));

    // Wait for voice profile to load
    await waitFor(() => {
      expect(ttsApi.getVoices).toHaveBeenCalled();
    });

    // Click save — should be blocked because no preview
    fireEvent.click(screen.getByRole('button', { name: /保存角色/ }));

    expect(onSaveRole).not.toHaveBeenCalled();
    expect(screen.getByText('试听音频尚未生成，请先点击「生成试听」')).toBeInTheDocument();
  });
});

describe('normalizeDraftForSave', () => {
  it('populates legacy fields from Edge-TTS voice', () => {
    const draft: RoleSnapshot = {
      id: 'r1',
      name: 'test',
      voice: { engine: 'edge_tts', voice: 'zh-CN-YunxiNeural', rate: '+0%', volume: '+0%' },
      favorite_styles: [],
      default_engine: 'edge_tts',
      default_voice: null,
      default_engine_params: { engine: 'edge_tts' },
    };
    const result = normalizeDraftForSave(draft);
    expect(result.default_engine).toBe('edge_tts');
    expect(result.default_voice).toBe('zh-CN-YunxiNeural');
    expect(result.default_engine_params).toEqual(draft.voice);
  });

  it('populates legacy fields from MiMo voice', () => {
    const draft: RoleSnapshot = {
      id: 'r2',
      name: 'test-mimo',
      voice: { engine: 'mimo_tts', mode: 'voiceclone', voice_id: 'v1' },
      favorite_styles: [],
      default_engine: 'mimo_tts',
      default_voice: null,
      default_engine_params: { engine: 'mimo_tts' },
    };
    const result = normalizeDraftForSave(draft);
    expect(result.default_engine).toBe('mimo_tts');
    expect(result.default_voice).toBeNull();
    expect(result.default_engine_params).toEqual(draft.voice);
  });

  it('handles missing voice gracefully', () => {
    const draft: RoleSnapshot = {
      id: 'r3',
      name: 'no-voice',
      favorite_styles: [],
      default_engine: 'edge_tts',
      default_voice: null,
      default_engine_params: { engine: 'edge_tts' },
    };
    const result = normalizeDraftForSave(draft);
    expect(result.default_engine).toBe('edge_tts');
    expect(result.default_voice).toBeNull();
  });
});

describe('design voice loading in editor', () => {
  it('shows preview audio when editing a role with design voice', async () => {
    const ttsApi = await import('../../services/api');
    vi.mocked(ttsApi.ttsApi.getVoices).mockResolvedValue([
      {
        id: 'vp-design-1',
        name: 'design-voice',
        voice: { model: 'mimo_tts', voice_type: 'design' },
        voice_params: { mimo_tts: { params: {} } },
        preview: { preview_audio_path: 'output/test.mp3' },
        has_preview: true,
        has_source: false,
        created_at: '2026-01-01T00:00:00.000Z',
      } as any,
    ]);

    const designRole: Role = {
      id: 'role-design',
      name: 'Design角色',
      description: null,
      avatar: null,
      role_kind: 'cast',
      voice: { engine: 'mimo_tts', mode: 'voicedesign', voice_id: 'vp-design-1' } as any,
      favorite_styles: [],
      default_engine: 'mimo_tts',
      default_voice: null,
      default_engine_params: { engine: 'mimo_tts', mode: 'voicedesign', voice_id: 'vp-design-1' } as any,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
      project_id: null,
    };

    render(
      <ProjectVoices
        roles={[designRole]}
        onSaveRole={vi.fn()}
        onPreviewRole={vi.fn()}
        onManageRoles={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /编辑 Design角色/ }));

    await waitFor(() => {
      expect(ttsApi.ttsApi.getVoices).toHaveBeenCalledWith({ voice_id: 'vp-design-1' });
    });

    // After loading, the audio player should be visible (design phase = confirmed)
    await waitFor(() => {
      const audio = document.querySelector('audio');
      expect(audio).toBeTruthy();
      expect(audio?.getAttribute('src')).toContain('?field=preview');
    });
  });

  it('switches engine to mimo_tts when clicking design tab on a new role', async () => {
    // Render ProjectVoices with empty roles — the "创建角色" button creates a draft with edge_tts
    const onSaveRole = vi.fn();
    render(
      <ProjectVoices
        roles={[]}
        onSaveRole={onSaveRole}
        onPreviewRole={vi.fn()}
        onManageRoles={vi.fn()}
      />,
    );

    // Click "创建角色" to open the editor with a new draft (engine=edge_tts)
    fireEvent.click(screen.getByRole('button', { name: /创建角色/ }));

    // Now the VoiceRoleEditor is visible. Click the "设计新音色" tab.
    await waitFor(() => {
      expect(screen.getByRole('radio', { name: '设计新音色' })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('radio', { name: '设计新音色' }));

    // After clicking design, the textarea for voice description should be visible and enabled
    await waitFor(() => {
      const textarea = screen.getByPlaceholderText(/描述你想要的音色/);
      expect(textarea).toBeInTheDocument();
      expect(textarea).not.toBeDisabled();
    });

    // Type in the textarea
    const textarea = screen.getByPlaceholderText(/描述你想要的音色/) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '温柔女声' } });
    expect(textarea.value).toBe('温柔女声');

    // Type more — value should accumulate
    fireEvent.change(textarea, { target: { value: '温柔女声，语速适中' } });
    expect(textarea.value).toBe('温柔女声，语速适中');
  });
});
