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

  it('saves edited role with correct params', () => {
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

    expect(onSaveRole).toHaveBeenCalledWith(expect.objectContaining({
      name: '新旁白名',
      default_engine: 'edge_tts',
      default_voice: 'zh-CN-XiaoxiaoNeural',
      default_engine_params: expect.objectContaining({
        edge_voice: 'zh-CN-XiaoxiaoNeural',
        edge_rate: '+10%',
      }),
    }));
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

  it('opens Edge-TTS editor with correct params', () => {
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

    expect(onSaveRole).toHaveBeenCalledWith(expect.objectContaining({
      default_engine: 'edge_tts',
      default_voice: 'zh-CN-XiaoxiaoNeural',
      default_engine_params: expect.objectContaining({
        engine: 'edge_tts',
        edge_voice: 'zh-CN-XiaoxiaoNeural',
        edge_rate: '+20%',
        edge_volume: '+10%',
      }),
    }));
  });
});
