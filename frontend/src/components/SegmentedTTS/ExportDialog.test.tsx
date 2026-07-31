import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../../hooks/useStorageMode', () => ({ useStorageMode: () => ({ mode: 'backend' }) }));

afterEach(() => cleanup());

import { ExportDialog } from './ExportDialog';

const baseProps = {
  projectId: 'p1',
  chapterId: 'c1',
  segments: [],
  defaultName: 'export',
  onClose: vi.fn(),
};

describe('ExportDialog defaults', () => {
  it('defaults to MP3 audio + SRT subtitle selected, script JSON hidden', () => {
    render(<ExportDialog {...baseProps} />);
    // audio + srt checked by default
    expect(screen.getByLabelText(/MP3 音频/)).toBeChecked();
    expect(screen.getByLabelText('SRT 字幕')).toBeChecked();
    // script JSON option hidden (not rendered)
    expect(screen.queryByLabelText(/脚本 JSON/)).not.toBeInTheDocument();
  });

  it('SRT defaults to chapter timeline even when a global offset is present', () => {
    render(<ExportDialog {...baseProps} globalStartOffset={120} />);
    // global-time checkbox appears (offset > 0) but defaults to OFF = chapter timeline
    expect(screen.getByLabelText(/使用全局时间轴/)).not.toBeChecked();
  });
});
