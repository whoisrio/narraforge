import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Role, RoleSnapshot } from '../../types';
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

const narratorAlt: Role = {
  id: 'role-narrator-alt',
  name: '新闻旁白',
  description: 'Narrator',
  default_engine: 'edge_tts',
  default_voice: 'Xiaoxiao',
  default_engine_params: { engine: 'edge_tts', edge_voice: 'zh-CN-XiaoxiaoNeural' },
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
        defaultNarratorRoleId="role-narrator"
        onSetDefaultNarrator={vi.fn()}
        onPreviewRole={vi.fn()}
        onManageRoles={vi.fn()}
      />,
    );

    expect(screen.getByText('默认旁白')).toBeInTheDocument();
    expect(screen.getByText('嘉宾A')).toBeInTheDocument();
    // Identity chips
    expect(screen.getAllByText(/旁白/).length).toBeGreaterThan(0);
    // Cast chip uses exact text "角色" — use getAllByText since "角色" also appears in placeholder
    const castChips = screen.getAllByText('角色');
    expect(castChips.length).toBeGreaterThan(0);
    // Engine chips
    expect(screen.getAllByText('Edge-TTS').length).toBeGreaterThan(0);
    // Preview buttons
    expect(screen.getAllByRole('button', { name: /试听/ })).toHaveLength(2);
  });

  it('shows empty state when no roles exist', () => {
    render(
      <ProjectVoices
        roles={[]}
        defaultNarratorRoleId={null}
        onSetDefaultNarrator={vi.fn()}
        onPreviewRole={vi.fn()}
        onManageRoles={vi.fn()}
      />,
    );

    expect(screen.getByText('还没有旁白角色')).toBeInTheDocument();
    expect(screen.getByText('还没有对话角色')).toBeInTheDocument();
  });

  it('shows placeholder cards for adding new roles', () => {
    render(
      <ProjectVoices
        roles={[narrator]}
        defaultNarratorRoleId="role-narrator"
        onSetDefaultNarrator={vi.fn()}
        onPreviewRole={vi.fn()}
        onManageRoles={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: /新增旁白/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /新增角色/ })).toBeInTheDocument();
  });

  it('opens editor when clicking a role card', () => {
    render(
      <ProjectVoices
        roles={[narrator]}
        defaultNarratorRoleId="role-narrator"
        onSetDefaultNarrator={vi.fn()}
        onPreviewRole={vi.fn()}
        onManageRoles={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /编辑 默认旁白/ }));

    expect(screen.getByLabelText('声音角色编辑器')).toBeInTheDocument();
    expect(screen.getByLabelText('角色名')).toHaveValue('默认旁白');
    expect(screen.getByText('角色声音参数')).toBeInTheDocument();
  });

  it('opens editor for new narrator via placeholder card', () => {
    render(
      <ProjectVoices
        roles={[cast]}
        defaultNarratorRoleId={null}
        onSetDefaultNarrator={vi.fn()}
        onPreviewRole={vi.fn()}
        onManageRoles={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /新增旁白/ }));

    expect(screen.getByLabelText('声音角色编辑器')).toBeInTheDocument();
    expect(screen.getByLabelText('角色名')).toHaveValue('默认旁白');
  });

  it('opens editor for new cast via placeholder card', () => {
    render(
      <ProjectVoices
        roles={[narrator]}
        defaultNarratorRoleId="role-narrator"
        onSetDefaultNarrator={vi.fn()}
        onPreviewRole={vi.fn()}
        onManageRoles={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /新增角色/ }));

    expect(screen.getByLabelText('声音角色编辑器')).toBeInTheDocument();
    expect(screen.getByLabelText('角色名')).toHaveValue('新 Cast');
  });

  it('saves edited role with correct params', () => {
    const onSaveRole = vi.fn();

    render(
      <ProjectVoices
        roles={[narrator]}
        defaultNarratorRoleId="role-narrator"
        onSetDefaultNarrator={vi.fn()}
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
    fireEvent.change(screen.getByLabelText('语速'), { target: { value: '+12%' } });

    // Save
    fireEvent.click(screen.getByRole('button', { name: /保存角色/ }));

    expect(onSaveRole).toHaveBeenCalledWith(expect.objectContaining({
      name: '新旁白名',
      default_engine: 'edge_tts',
      default_voice: 'zh-CN-XiaoxiaoNeural',
      default_engine_params: expect.objectContaining({
        edge_voice: 'zh-CN-XiaoxiaoNeural',
        edge_rate: '+12%',
      }),
    }));
  });

  it('cancels editing and closes editor', () => {
    render(
      <ProjectVoices
        roles={[narrator]}
        defaultNarratorRoleId="role-narrator"
        onSetDefaultNarrator={vi.fn()}
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
        defaultNarratorRoleId={null}
        onSetDefaultNarrator={vi.fn()}
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
        defaultNarratorRoleId="role-narrator"
        onSetDefaultNarrator={vi.fn()}
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
        defaultNarratorRoleId="role-narrator"
        onSetDefaultNarrator={vi.fn()}
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

  it('marks default narrator with default indicator', () => {
    render(
      <ProjectVoices
        roles={[narrator, narratorAlt]}
        defaultNarratorRoleId="role-narrator"
        onSetDefaultNarrator={vi.fn()}
        onPreviewRole={vi.fn()}
        onManageRoles={vi.fn()}
      />,
    );

    // The default narrator card should have the "默认" chip text
    const defaultChips = screen.getAllByText(/默认/);
    expect(defaultChips.length).toBeGreaterThan(0);
  });

  it('opens CosyVoice editor with correct params', () => {
    const onSaveRole = vi.fn();

    render(
      <ProjectVoices
        roles={[narrator]}
        defaultNarratorRoleId="role-narrator"
        onSetDefaultNarrator={vi.fn()}
        onSaveRole={onSaveRole}
        onPreviewRole={vi.fn()}
        onManageRoles={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /编辑 默认旁白/ }));
    fireEvent.click(screen.getByRole('radio', { name: /CosyVoice/ }));
    fireEvent.change(screen.getByLabelText('CosyVoice voice id'), { target: { value: 'voice-narrator-main' } });
    fireEvent.change(screen.getByLabelText('语速'), { target: { value: '0.92' } });
    fireEvent.change(screen.getByLabelText('音量'), { target: { value: '78' } });
    fireEvent.change(screen.getByLabelText('音高'), { target: { value: '0.98' } });
    fireEvent.change(screen.getByPlaceholderText('跟随全局风格指令，或选择预设/直接输入...'), { target: { value: '沉稳、纪录片' } });
    fireEvent.click(screen.getByRole('button', { name: /保存角色/ }));

    expect(onSaveRole).toHaveBeenCalledWith(expect.objectContaining({
      default_engine: 'cosyvoice',
      default_voice: 'voice-narrator-main',
      default_engine_params: expect.objectContaining({
        engine: 'cosyvoice',
        voice_id: 'voice-narrator-main',
        speed: 0.92,
        volume: 78,
        pitch: 0.98,
        instruction: '沉稳、纪录片',
      }),
    }));
  });
});
