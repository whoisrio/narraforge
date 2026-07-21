import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StoryboardPanel } from './StoryboardPanel';

const chapters = [
  {
    id: 'c1',
    name: '第一章',
    segments: [
      {
        id: 's1',
        position: 0,
        text: '旁白一',
        animation_spec: {
          start_sec: 0,
          end_sec: 4.2,
          narration_text: '旁白一',
          visual_content: { type: 'code', description: '展示初始化代码', source_ref: null },
          animation: { effect: 'typewriter', notes: '逐行打出' },
        },
      },
      {
        id: 's2',
        position: 1,
        text: '旁白二（无 brief）',
        animation_spec: null,
      },
    ],
  },
];

describe('StoryboardPanel', () => {
  it('renders a card per segment that has a brief', () => {
    render(<StoryboardPanel chapters={chapters} />);
    expect(screen.getByText('第一章')).toBeTruthy();
    expect(screen.getByText('00:00 – 00:04')).toBeTruthy();
    expect(screen.getByText('旁白一')).toBeTruthy();
    expect(screen.getByText('展示初始化代码')).toBeTruthy();
    expect(screen.getByText(/typewriter/)).toBeTruthy();
    // 无 brief 的段落不渲染
    expect(screen.queryByText('旁白二（无 brief）')).toBeNull();
  });

  it('shows visual content type label', () => {
    render(<StoryboardPanel chapters={chapters} />);
    expect(screen.getByText('代码')).toBeTruthy();
  });

  it('shows empty state when no briefs exist', () => {
    render(<StoryboardPanel chapters={[{ id: 'c', name: 'x', segments: [] }]} />);
    expect(screen.getByText(/暂无分镜数据/)).toBeTruthy();
  });
});
