import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Role, Segment } from '../../types';
import { ChatSegmentView } from './ChatSegmentView';

const baseParams = { engine: 'edge_tts' as const, edge_voice: 'zh-CN-YunxiNeural', language: 'Chinese' };

function makeSegment(id: string, kind: 'narration' | 'dialogue', text: string): Segment {
  return {
    id,
    text,
    params: baseParams,
    status: kind === 'dialogue' ? 'ready' : 'idle',
    segment_kind: kind,
    role_id: kind === 'dialogue' ? 'role-a' : null,
    emotion: kind === 'dialogue' ? 'excited' : 'calm',
    prosody_marks: [],
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}

const roles: Role[] = [{
  id: 'role-a',
  name: '嘉宾A',
  default_engine: 'edge_tts',
  default_voice: 'Yunxi',
  default_engine_params: baseParams,
  favorite_styles: [],
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
}];

const extraRoles: Role[] = [
  ...roles,
  {
    id: 'role-b',
    name: '嘉宾B',
    default_engine: 'edge_tts',
    default_voice: 'Yunyang',
    default_engine_params: { ...baseParams, edge_voice: 'zh-CN-YunyangNeural' },
    favorite_styles: [],
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  },
];

describe('ChatSegmentView studio script flow', () => {
  it('renders a production empty state when there are no segments', () => {
    const onAppend = vi.fn();

    render(
      <ChatSegmentView
        segments={[]}
        roles={roles}
        selectedId={undefined}
        playingId={undefined}
        hasNarratorVoice
        onSelect={vi.fn()}
        onAppend={onAppend}
        onRegenerate={vi.fn()}
        onPlay={vi.fn()}
        onUpdateProsodyMarks={vi.fn()}
      />,
    );

    expect(screen.getByText('Script Production Flow')).toBeInTheDocument();
    expect(screen.getByText('暂无分段')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /新增台词/ }));
    expect(onAppend).toHaveBeenCalledWith('dialogue');
  });

  it('renders narration and dialogue as production blocks, not chat bubbles', () => {
    render(
      <ChatSegmentView
        segments={[
          makeSegment('s1', 'narration', '旁白内容'),
          makeSegment('s2', 'dialogue', '台词内容'),
        ]}
        roles={roles}
        selectedId="s2"
        playingId="s2"
        hasNarratorVoice
        onSelect={vi.fn()}
        onAppend={vi.fn()}
        onRegenerate={vi.fn()}
        onPlay={vi.fn()}
        onUpdateProsodyMarks={vi.fn()}
      />,
    );

    expect(screen.getByText('Script Production Flow')).toBeInTheDocument();
    expect(screen.getByText('旁白 #01')).toBeInTheDocument();
    expect(screen.getByText('台词 #02')).toBeInTheDocument();
    expect(screen.getByText('嘉宾A')).toBeInTheDocument();
    expect(screen.getByText('台词内容')).toBeInTheDocument();
    expect(screen.getByText(/Edge-TTS/)).toBeInTheDocument();
    expect(screen.getByText('excited')).toBeInTheDocument();
  });

  it('keeps regenerate, play, append dialogue, and append narration actions wired', () => {
    const onRegenerate = vi.fn();
    const onPlay = vi.fn();
    const onAppend = vi.fn();

    render(
      <ChatSegmentView
        segments={[makeSegment('s1', 'dialogue', '台词内容')]}
        roles={roles}
        selectedId="s1"
        playingId={undefined}
        hasNarratorVoice
        onSelect={vi.fn()}
        onAppend={onAppend}
        onRegenerate={onRegenerate}
        onPlay={onPlay}
        onUpdateProsodyMarks={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /播放/ }));
    fireEvent.click(screen.getByRole('button', { name: /生成/ }));
    fireEvent.click(screen.getByRole('button', { name: /新增台词/ }));
    fireEvent.click(screen.getByRole('button', { name: /新增旁白/ }));

    expect(onPlay).toHaveBeenCalledWith('s1');
    expect(onRegenerate).toHaveBeenCalledWith('s1');
    expect(onAppend).toHaveBeenCalledWith('dialogue');
    expect(onAppend).toHaveBeenCalledWith('narration');
  });

  it('lets each dialogue block choose a Voice Role', () => {
    const onUpdateRole = vi.fn();
    const segment = makeSegment('s1', 'dialogue', '台词内容');
    segment.role_id = null;

    render(
      <ChatSegmentView
        segments={[segment]}
        roles={extraRoles}
        selectedId="s1"
        playingId={undefined}
        hasNarratorVoice
        onSelect={vi.fn()}
        onAppend={vi.fn()}
        onRegenerate={vi.fn()}
        onPlay={vi.fn()}
        onUpdateRole={onUpdateRole}
        onUpdateProsodyMarks={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText('选择角色'), { target: { value: 'role-b' } });

    expect(onUpdateRole).toHaveBeenCalledWith('s1', 'role-b', expect.objectContaining({
      id: 'role-b',
      name: '嘉宾B',
      default_voice: 'Yunyang',
    }));
  });
});
