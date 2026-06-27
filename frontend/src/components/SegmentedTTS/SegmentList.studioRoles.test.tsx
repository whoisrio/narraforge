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
    role_id: kind === 'dialogue' ? 'cast-1' : null,
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
  it('hides kind controls in narration mode', () => {
    renderList({ voiceMode: 'narration' });

    expect(screen.queryByText('旁白')).not.toBeInTheDocument();
    expect(screen.queryByText('对话')).not.toBeInTheDocument();
  });

  it('shows segment kind controls in dialogue mode and switches kind with matching role snapshot', () => {
    const onUpdateKind = vi.fn();

    renderList({ voiceMode: 'dialogue', onUpdateKind });

    // Kind badges are shown — use getAllByText since text appears in both badge and button
    expect(screen.getAllByText('旁白').length).toBeGreaterThan(0);
    expect(screen.getAllByText('对话').length).toBeGreaterThan(0);

    // Find and click the kind switch button (has kindSwitch class)
    const kindSwitches = document.querySelectorAll('[class*="kindSwitch"]');
    expect(kindSwitches.length).toBeGreaterThan(0);
    fireEvent.click(kindSwitches[0]);

    // Narration segment "旁白内容" has no speaker prefix, so first role is assigned as fallback
    expect(onUpdateKind).toHaveBeenCalledWith('s1', 'dialogue', expect.objectContaining({
      id: 'narrator-1',
      name: '默认旁白',
    }));
  });

  it('shows all roles for dialogue segments (no narrator/cast split)', () => {
    const onUpdateRole = vi.fn();

    renderList({ voiceMode: 'dialogue', onUpdateRole });

    // All roles should be available in the role picker
    const roleChips = screen.getAllByRole('button', { name: /嘉宾A|默认旁白/ });
    expect(roleChips.length).toBeGreaterThan(0);
  });

  it('keeps long role names in a fixed-width ellipsis preview', () => {
    renderList({
      voiceMode: 'dialogue',
      segments: [makeSegment('s-long', 'dialogue')].map(segment => ({
        ...segment,
        role_id: 'cast-long',
      })),
      onUpdateRole: vi.fn(),
    });

    // The long role name should appear as a title attribute for tooltip
    const titledElements = screen.getAllByTitle('这是一个非常非常非常长的角色名字会把Segment信息挤歪');
    expect(titledElements.length).toBeGreaterThan(0);
  });
});
