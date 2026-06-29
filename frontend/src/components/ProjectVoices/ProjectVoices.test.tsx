import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Role } from '../../types';
import { ProjectVoices } from './ProjectVoices';

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

const narrator: Role = {
  id: 'role-narrator',
  name: '默认旁白',
  description: 'Narrator',
  default_engine: 'edge_tts',
  default_voice: 'Yunxi',
  default_engine_params: { engine: 'edge_tts', edge_voice: 'zh-CN-YunxiNeural' },
  favorite_styles: [],
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

const cast: Role = {
  id: 'role-guest-a',
  name: '嘉宾A',
  description: 'Cast',
  default_engine: 'edge_tts',
  default_voice: 'Yunyang',
  default_engine_params: { engine: 'edge_tts', edge_voice: 'zh-CN-YunyangNeural' },
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

  it('saves edited role with correct params', async () => {
    const onSaveRole = vi.fn();

    render(
      <ProjectVoices
        roles={[narrator]}
        onSaveRole={onSaveRole}
        onPreviewRole={vi.fn()}
        onManageRoles={vi.fn()}
      />,
    );

    // Click card to open editor
    fireEvent.click(screen.getByRole('button', { name: /编辑 默认旁白/ }));

    // Modify name and voice
    fireEvent.change(screen.getByLabelText('角色名'), { target: { value: '新旁白名' } });
    fireEvent.change(screen.getByLabelText('音色'), { target: { value: 'zh-CN-XiaoxiaoNeural' } });
    fireEvent.change(screen.getByLabelText('语速'), { target: { value: '+10%' } });

    // Save
    fireEvent.click(screen.getByRole('button', { name: /保存角色/ }));

    await waitFor(() => {
      expect(onSaveRole).toHaveBeenCalledWith(expect.objectContaining({
        name: '新旁白名',
        default_engine: 'edge_tts',
        default_engine_params: expect.objectContaining({
          edge_voice: 'zh-CN-XiaoxiaoNeural',
          edge_rate: '+10%',
          voice_id: 'new-profile-id',
        }),
      }));
    });
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

  it('previews role from card', () => {
    const onPreviewRole = vi.fn();

    render(
      <ProjectVoices
        roles={[cast]}
        onPreviewRole={onPreviewRole}
        onManageRoles={vi.fn()}
      />,
    );

    fireEvent.click(screen.getAllByRole('button', { name: /试听/ })[0]);

    expect(onPreviewRole).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'role-guest-a' }),
      expect.any(String),
    );
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
      default_engine: 'cosyvoice',
      default_voice: 'voice-123',
      default_engine_params: { engine: 'cosyvoice', voice_id: 'voice-123' },
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

  it('opens Edge-TTS editor with correct params', async () => {
    const onSaveRole = vi.fn();

    render(
      <ProjectVoices
        roles={[narrator]}
        onSaveRole={onSaveRole}
        onPreviewRole={vi.fn()}
        onManageRoles={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /编辑 默认旁白/ }));

    // Edge-TTS is the default preset engine — change voice and rate
    fireEvent.change(screen.getByLabelText('音色'), { target: { value: 'zh-CN-XiaoxiaoNeural' } });
    fireEvent.change(screen.getByLabelText('语速'), { target: { value: '+20%' } });
    fireEvent.change(screen.getByLabelText('音量'), { target: { value: '+10%' } });

    fireEvent.click(screen.getByRole('button', { name: /保存角色/ }));

    await waitFor(() => {
      expect(onSaveRole).toHaveBeenCalledWith(expect.objectContaining({
        default_engine: 'edge_tts',
        default_engine_params: expect.objectContaining({
          engine: 'edge_tts',
          edge_voice: 'zh-CN-XiaoxiaoNeural',
          edge_rate: '+20%',
          edge_volume: '+10%',
          voice_id: 'new-profile-id',
        }),
      }));
    });
  });
});

describe('ProjectVoices – input method label', () => {
  it('renders input method chip when role has input_method in engine_params', () => {
    const recordRole: Role = {
      ...cast,
      id: 'role-record',
      name: '录制角色',
      default_engine: 'mimo_tts',
      default_voice: 'voice-abc',
      default_engine_params: {
        engine: 'mimo_tts',
        mimo_mode: 'voiceclone',
        mimo_clone_voice_id: 'voice-abc',
        input_method: 'record',
      },
    };

    render(
      <ProjectVoices
        roles={[recordRole]}
        onPreviewRole={vi.fn()}
        onManageRoles={vi.fn()}
      />,
    );

    expect(screen.getByText('录制')).toBeInTheDocument();
  });

  it('renders URL chip for url input method', () => {
    const urlRole: Role = {
      ...cast,
      id: 'role-url',
      name: 'URL角色',
      default_engine: 'cosyvoice',
      default_voice: 'voice-xyz',
      default_engine_params: {
        engine: 'cosyvoice',
        voice_id: 'voice-xyz',
        input_method: 'url',
      },
    };

    render(
      <ProjectVoices
        roles={[urlRole]}
        onPreviewRole={vi.fn()}
        onManageRoles={vi.fn()}
      />,
    );

    expect(screen.getByText('URL')).toBeInTheDocument();
  });

  it('does not render input method chip when input_method is absent', () => {
    render(
      <ProjectVoices
        roles={[narrator]}
        onPreviewRole={vi.fn()}
        onManageRoles={vi.fn()}
      />,
    );

    // narrator has no input_method in default_engine_params
    expect(screen.queryByText('录制')).not.toBeInTheDocument();
    expect(screen.queryByText('上传')).not.toBeInTheDocument();
    expect(screen.queryByText('URL')).not.toBeInTheDocument();
  });
});

describe('ProjectVoices – clone preview validation', () => {
  const cloneRole: Role = {
    id: 'role-clone-1',
    name: '克隆角色',
    default_engine: 'mimo_tts',
    default_voice: 'voice-abc',
    default_engine_params: {
      engine: 'mimo_tts',
      mimo_mode: 'voiceclone',
      mimo_clone_voice_id: 'voice-abc',
    },
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
      is_cloned: true,
      clone_engine: 'mimo',
      voices_engine: { type: 'clone', engine: { type: 'Mimo', sub_type: 'mimo-clone' }, parameters: {} },
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

  it('shows error message when clone preview generation fails', async () => {
    const { synthesizeVoiceRolePreview } = await import('../../services/voiceRolePreview');
    (synthesizeVoiceRolePreview as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('TTS 服务不可用'));

    const { ttsApi } = await import('../../services/api');
    (ttsApi.getVoices as ReturnType<typeof vi.fn>).mockResolvedValue([{
      id: 'voice-abc',
      name: 'cloned voice',
      audio_url: '',
      source_audio_url: '',
      cloned_preview_url: '',
      is_cloned: true,
      clone_engine: 'mimo',
      voices_engine: { type: 'clone', engine: { type: 'Mimo', sub_type: 'mimo-clone' }, parameters: {} },
      created_at: '2026-01-01T00:00:00.000Z',
    }]);

    render(
      <ProjectVoices
        roles={[cloneRole]}
        onPreviewRole={vi.fn()}
        onManageRoles={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /编辑 克隆角色/ }));

    await waitFor(() => {
      expect(ttsApi.getVoices).toHaveBeenCalled();
    });

    // Click "生成试听"
    fireEvent.click(screen.getByRole('button', { name: /生成试听/ }));

    await waitFor(() => {
      expect(screen.getByText('TTS 服务不可用')).toBeInTheDocument();
    });
  });
});
