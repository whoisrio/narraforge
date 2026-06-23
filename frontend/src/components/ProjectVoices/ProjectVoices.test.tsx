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

    expect(onCreateDefaultNarrator).toHaveBeenCalled();
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

    fireEvent.click(screen.getByRole('button', { name: /新增 Cast/ }));
    fireEvent.click(screen.getAllByRole('button', { name: /试听/ })[1]);

    expect(onCreateCast).toHaveBeenCalled();
    expect(onPreviewRole).toHaveBeenCalledWith(expect.objectContaining({ id: 'role-guest-a' }), expect.any(String));
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
});
