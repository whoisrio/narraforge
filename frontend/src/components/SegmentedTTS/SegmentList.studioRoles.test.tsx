import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Role, Segment } from '../../types';
import { SegmentList } from './SegmentList';

const baseParams = { engine: 'edge_tts' as const, edge_voice: 'zh-CN-YunxiNeural' };

const roles: Role[] = [
  {
    id: 'narrator-1',
    name: '默认旁白',
    description: 'Narrator',
    default_engine: 'edge_tts',
    default_voice: 'zh-CN-YunxiNeural',
    default_engine_params: baseParams,
    favorite_styles: [],
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
  },
  {
    id: 'cast-1',
    name: '嘉宾A',
    description: 'Cast',
    default_engine: 'edge_tts',
    default_voice: 'zh-CN-YunyangNeural',
    default_engine_params: { ...baseParams, edge_voice: 'zh-CN-YunyangNeural' },
    favorite_styles: [],
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
  },
  {
    id: 'cast-long',
    name: '这是一个非常非常非常长的角色名字会把Segment信息挤歪',
    description: 'Cast',
    default_engine: 'edge_tts',
    default_voice: 'zh-CN-YunyangNeural',
    default_engine_params: { ...baseParams, edge_voice: 'zh-CN-YunyangNeural' },
    favorite_styles: [],
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
  },
];

function makeSegment(id: string, kind: 'narration' | 'dialogue'): Segment {
  return {
    id,
    text: kind === 'narration' ? '旁白内容' : '嘉宾：台词内容',
    params: baseParams,
    status: 'idle',
    segment_kind: kind,
    role_id: kind === 'dialogue' ? 'cast-1' : 'narrator-1',
    emotion: 'calm',
    prosody_marks: [],
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
  };
}

function renderList(overrides: Partial<React.ComponentProps<typeof SegmentList>> = {}) {
  return render(
    <SegmentList
      segments={[makeSegment('s1', 'narration'), makeSegment('s2', 'dialogue')]}
      layout="vertical"
      selectedId={undefined}
      playingId={undefined}
      compact
      voices={[]}
      engine="edge_tts"
      globalEdgeVoice="zh-CN-YunxiNeural"
      roles={roles}
      onSelect={vi.fn()}
      onDelete={vi.fn()}
      onInsertAfter={vi.fn()}
      onAppend={vi.fn()}
      onReorder={vi.fn()}
      onEdit={vi.fn()}
      onRegenerate={vi.fn()}
      onPlay={vi.fn()}
      onUndo={vi.fn()}
      {...overrides}
    />,
  );
}

describe('SegmentList studio role controls', () => {
  it('hides kind controls and narrator labels in narration mode', () => {
    renderList({ voiceMode: 'narration' });

    expect(screen.queryByText('旁白')).not.toBeInTheDocument();
    expect(screen.queryByText('台词')).not.toBeInTheDocument();
    expect(screen.queryByText('Narrator')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('选择旁白角色')).not.toBeInTheDocument();
  });

  it('shows segment kind controls in mixed mode and switches kind with matching role snapshot', () => {
    const onUpdateKind = vi.fn();

    renderList({ voiceMode: 'mixed', onUpdateKind });

    expect(screen.getByText('旁白')).toBeInTheDocument();
    expect(screen.getByText('台词')).toBeInTheDocument();
    expect(screen.queryByText('Narrator')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /改为台词/ }));

    expect(onUpdateKind).toHaveBeenCalledWith('s1', 'dialogue', expect.objectContaining({
      id: 'cast-1',
      name: '嘉宾A',
    }));
  });

  it('only shows Cast role pickers for dialogue segments', () => {
    const onUpdateRole = vi.fn();

    renderList({ voiceMode: 'mixed', onUpdateRole });

    expect(screen.queryByLabelText('选择旁白角色')).not.toBeInTheDocument();
    expect(screen.queryByText('Narrator')).not.toBeInTheDocument();

    const castOptions = Array.from(screen.getByLabelText('选择台词角色').querySelectorAll('option')).map(option => option.textContent);

    expect(castOptions).toContain('嘉宾A');
    expect(castOptions).not.toContain('默认旁白');

    fireEvent.change(screen.getByLabelText('选择台词角色'), { target: { value: 'cast-1' } });

    expect(onUpdateRole).toHaveBeenCalledWith('s2', 'cast-1', expect.objectContaining({
      id: 'cast-1',
      name: '嘉宾A',
    }));
  });

  it('keeps long Cast role names in a fixed-width ellipsis preview', () => {
    renderList({
      voiceMode: 'mixed',
      segments: [makeSegment('s-long', 'dialogue')].map(segment => ({
        ...segment,
        role_id: 'cast-long',
      })),
      onUpdateRole: vi.fn(),
    });

    const preview = screen.getAllByTitle('这是一个非常非常非常长的角色名字会把Segment信息挤歪')
      .find(element => element.className.includes('roleNamePreview'));
    expect(preview).toBeTruthy();
    expect(preview?.className).toContain('roleNamePreview');
    expect(screen.getByLabelText('选择台词角色')).toBeInTheDocument();
  });
});
