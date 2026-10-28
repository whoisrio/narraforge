import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { Segment } from '../../types';
import { SegmentRow } from './SegmentRow';

function makeSegment(): Segment {
  return {
    id: 's1', text: '调用 REST API 接口。', voice: { source: 'chapter' }, status: 'idle',
    audio: { format: 'mp3' }, segment_kind: 'narration', created_at: 'x', updated_at: 'x',
  };
}

const noop = () => {};

function renderRow(extra: Partial<React.ComponentProps<typeof SegmentRow>> = {}) {
  return render(
    <SegmentRow
      segment={makeSegment()}
      index={1}
      isSelected={false}
      isPlaying={false}
      isPaused={false}
      layout="vertical"
      compact
      voices={[]}
      roles={[]}
      onSelect={noop} onDelete={noop} onEdit={noop}
      onRegenerate={noop} onPlay={noop} onUndo={noop}
      isLast
      {...extra}
    />,
  );
}

describe('SegmentRow 发音映射 badge', () => {
  it('有已应用映射时显示 🗣 + 数量，title 列出 source->target', () => {
    renderRow({ pronunciationPreview: [{ source: '调动', target: '掉动' }, { source: 'REST', target: 'rest' }] });
    const badge = screen.getByText('🗣 2');
    expect(badge.getAttribute('title')).toContain('调动->掉动\nREST->rest');
  });

  it('无已应用映射时不显示 badge', () => {
    renderRow();
    expect(screen.queryByText(/🗣/)).toBeNull();
  });

  it('根元素带 data-segment-id（搜索结果滚动定位锚点）', () => {
    const { container } = renderRow();
    expect(container.querySelector('[data-segment-id="s1"]')).toBeTruthy();
  });
});

describe('SegmentRow 合成状态', () => {
  it.each(['pending', 'queued'] as const)('%s 段显示合成中，而不是播放按钮', (status) => {
    const segment: Segment = {
      ...makeSegment(),
      status,
      audio: { format: 'mp3', current: { path: 'projects/p/audio/s1.mp3' } },
    };

    renderRow({ segment });

    expect(screen.queryByTitle('播放')).toBeNull();
    expect(screen.getByTitle('合成中...')).toBeTruthy();
  });

  it('已完成的段仍然显示播放按钮并可播放', () => {
    const onPlay = vi.fn();
    const segment: Segment = {
      ...makeSegment(),
      status: 'ready',
      audio: { format: 'mp3', current: { path: 'projects/p/audio/s1.mp3' } },
    };

    renderRow({ segment, onPlay });

    fireEvent.click(screen.getByTitle('播放'));
    expect(onPlay).toHaveBeenCalledWith('s1');
    expect(screen.queryByTitle('合成中...')).toBeNull();
  });

  it('没有可播放音频且未合成时不显示播放按钮', () => {
    renderRow({ segment: { ...makeSegment(), status: 'ready' } });
    expect(screen.queryByTitle('播放')).toBeNull();
  });

  it('展开态合成中同样不显示播放按钮', () => {
    const segment: Segment = {
      ...makeSegment(),
      status: 'pending',
      audio: { format: 'mp3', current: { path: 'projects/p/audio/s1.mp3' } },
    };

    renderRow({ segment, compact: false });

    expect(screen.queryByTitle('播放')).toBeNull();
    expect(screen.getByTitle('合成中...')).toBeTruthy();
  });
});
