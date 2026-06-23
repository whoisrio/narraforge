import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Role, RoleSnapshot } from '../../types';
import { DEFAULT_EDGE_CAST_VOICE, DEFAULT_EDGE_NARRATOR_VOICE } from '../../services/voiceRoleDefaults';
import { ProjectVoices } from './ProjectVoices';

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
  it('renders narrator and cast sections with preview controls', () => {
    render(
      <ProjectVoices
        roles={[narrator, cast]}
        defaultNarratorRoleId="role-narrator"
        onSetDefaultNarrator={vi.fn()}
        onCreateDefaultNarrator={vi.fn()}
        onCreateCast={vi.fn()}
        onPreviewRole={vi.fn()}
        onManageRoles={vi.fn()}
      />,
    );

    expect(screen.getByText('Narrator')).toBeInTheDocument();
    expect(screen.getByText('Cast')).toBeInTheDocument();
    expect(screen.getAllByText('默认旁白').length).toBeGreaterThan(0);
    expect(screen.getByText('嘉宾A')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /试听/ })).toHaveLength(2);
  });

  it('prompts to create a usable default narrator when missing', () => {
    const onCreateDefaultNarrator = vi.fn();

    render(
      <ProjectVoices
        roles={[cast]}
        defaultNarratorRoleId={null}
        onSetDefaultNarrator={vi.fn()}
        onCreateDefaultNarrator={onCreateDefaultNarrator}
        onCreateCast={vi.fn()}
        onPreviewRole={vi.fn()}
        onManageRoles={vi.fn()}
      />,
    );

    expect(screen.getByText('创建后将使用')).toBeInTheDocument();
    expect(screen.getByText(/Edge-TTS · zh-CN-YunxiNeural/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /创建默认旁白/ }));

    expect(screen.getByRole('heading', { name: /声音角色配置/ })).toBeInTheDocument();
    expect(screen.getByLabelText('角色名')).toHaveValue('默认旁白');
  });

  it('shows the actual voice that will be used for narrator creation', () => {
    render(
      <ProjectVoices
        roles={[]}
        defaultNarratorRoleId={null}
        defaultNarratorPreviewLabel="Edge-TTS · zh-HK-HiuGaaiNeural"
        onSetDefaultNarrator={vi.fn()}
        onCreateDefaultNarrator={vi.fn()}
        onCreateCast={vi.fn()}
        onPreviewRole={vi.fn()}
        onManageRoles={vi.fn()}
      />,
    );

    expect(screen.getByText(/Edge-TTS · zh-HK-HiuGaaiNeural/)).toBeInTheDocument();
  });

  it('creates cast and previews roles', () => {
    const onCreateCast = vi.fn();
    const onPreviewRole = vi.fn();

    render(
      <ProjectVoices
        roles={[narrator, cast]}
        defaultNarratorRoleId="role-narrator"
        onSetDefaultNarrator={vi.fn()}
        onCreateDefaultNarrator={vi.fn()}
        onCreateCast={onCreateCast}
        onPreviewRole={onPreviewRole}
        onManageRoles={vi.fn()}
      />,
    );

    fireEvent.click(screen.getAllByRole('button', { name: /试听/ })[1]);
    fireEvent.click(screen.getByRole('button', { name: /新增 Cast/ }));

    expect(onPreviewRole).toHaveBeenCalledWith(expect.objectContaining({ id: 'role-guest-a' }), expect.any(String));
    expect(screen.getByRole('heading', { name: /声音角色配置/ })).toBeInTheDocument();
  });

  it('does not treat existing narrator roles as the project default until selected', () => {
    render(
      <ProjectVoices
        roles={[narrator]}
        defaultNarratorRoleId={null}
        onSetDefaultNarrator={vi.fn()}
        onCreateDefaultNarrator={vi.fn()}
        onCreateCast={vi.fn()}
        onPreviewRole={vi.fn()}
        onManageRoles={vi.fn()}
      />,
    );

    expect(screen.getByText('还没有默认旁白')).toBeInTheDocument();
    expect(screen.getByText('创建后将使用')).toBeInTheDocument();
    expect(screen.queryByText('这是一段默认旁白试听，用于确认叙述声音是否沉稳、清晰，并适合长时间解说。')).not.toBeInTheDocument();
  });

  it('sets default narrator from available narrator roles', () => {
    const onSetDefaultNarrator = vi.fn();
    const roleSnapshot: RoleSnapshot = {
      id: narrator.id,
      name: narrator.name,
      description: narrator.description,
      default_engine: narrator.default_engine,
      default_voice: narrator.default_voice,
      default_engine_params: narrator.default_engine_params,
      favorite_styles: [],
    };

    render(
      <ProjectVoices
        roles={[narrator]}
        defaultNarratorRoleId={null}
        onSetDefaultNarrator={onSetDefaultNarrator}
        onCreateDefaultNarrator={vi.fn()}
        onCreateCast={vi.fn()}
        onPreviewRole={vi.fn()}
        onManageRoles={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText('默认旁白角色'), { target: { value: 'role-narrator' } });

    expect(onSetDefaultNarrator).toHaveBeenCalledWith('role-narrator', expect.objectContaining(roleSnapshot));
  });

  it('opens a voice role editor for a new Cast and saves Edge-TTS voice params', () => {
    const onSaveRole = vi.fn();

    render(
      <ProjectVoices
        roles={[narrator]}
        defaultNarratorRoleId="role-narrator"
        onSetDefaultNarrator={vi.fn()}
        onCreateDefaultNarrator={vi.fn()}
        onCreateCast={vi.fn()}
        onSaveRole={onSaveRole}
        onPreviewRole={vi.fn()}
        onManageRoles={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /新增 Cast/ }));

    expect(screen.getByRole('heading', { name: /声音角色配置/ })).toBeInTheDocument();
    expect(screen.getByText('TTS / Cloning Engine')).toBeInTheDocument();
    expect(screen.getByText('Studio Playback')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('角色名'), { target: { value: '嘉宾B' } });
    fireEvent.change(screen.getByLabelText('Edge voice'), { target: { value: 'zh-CN-XiaoxiaoNeural' } });
    fireEvent.change(screen.getByLabelText('语速'), { target: { value: '+12%' } });
    fireEvent.change(screen.getByLabelText('音量'), { target: { value: '+4%' } });
    fireEvent.click(screen.getByRole('button', { name: /保存角色/ }));

    expect(onSaveRole).toHaveBeenCalledWith(expect.objectContaining({
      name: '嘉宾B',
      description: 'Cast',
      default_engine: 'edge_tts',
      default_voice: 'zh-CN-XiaoxiaoNeural',
      default_engine_params: expect.objectContaining({
        engine: 'edge_tts',
        edge_voice: 'zh-CN-XiaoxiaoNeural',
        edge_rate: '+12%',
        edge_volume: '+4%',
      }),
    }));
  });

  it('edits an existing role and saves CosyVoice params', () => {
    const onSaveRole = vi.fn();

    render(
      <ProjectVoices
        roles={[narrator, cast]}
        defaultNarratorRoleId="role-narrator"
        onSetDefaultNarrator={vi.fn()}
        onCreateDefaultNarrator={vi.fn()}
        onCreateCast={vi.fn()}
        onSaveRole={onSaveRole}
        onPreviewRole={vi.fn()}
        onManageRoles={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '编辑 嘉宾A' }));
    fireEvent.click(screen.getByRole('radio', { name: /CosyVoice/ }));
    fireEvent.change(screen.getByLabelText('CosyVoice voice id'), { target: { value: 'voice-linxia' } });
    fireEvent.change(screen.getByLabelText('语速'), { target: { value: '1.18' } });
    fireEvent.change(screen.getByLabelText('音量'), { target: { value: '86' } });
    fireEvent.change(screen.getByLabelText('音高'), { target: { value: '1.05' } });
    fireEvent.change(screen.getByLabelText('风格指令'), { target: { value: '温柔、克制、纪录片旁白感' } });
    fireEvent.click(screen.getByRole('button', { name: /保存角色/ }));

    expect(onSaveRole).toHaveBeenCalledWith(expect.objectContaining({
      id: 'role-guest-a',
      name: '嘉宾A',
      default_engine: 'cosyvoice',
      default_voice: 'voice-linxia',
      default_engine_params: expect.objectContaining({
        engine: 'cosyvoice',
        voice_id: 'voice-linxia',
        speed: 1.18,
        volume: 86,
        pitch: 1.05,
        instruction: '温柔、克制、纪录片旁白感',
      }),
    }));
  });
});
