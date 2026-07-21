import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ExportDialog } from './ExportDialog';
import type { Segment } from '../../types';

// Mock services touched at module load / on export — none are called by simply
// rendering the dialog, but we mock to avoid axios/network side-effects.
vi.mock('../../services/api', () => ({
  segmentedProjectApi: {},
  subtitleLlmApi: {},
}));

vi.mock('../../services/audioConcat', () => ({
  buildSRTContent: vi.fn(),
  concatAudioBuffers: vi.fn(),
  encodeWAV: vi.fn(),
}));

vi.mock('../../services/indexedDB', () => ({
  getTTSAudioBlob: vi.fn(),
}));

vi.mock('../../services/segmentShims', () => ({
  segParams: vi.fn(),
}));

vi.mock('../../hooks/useStorageMode', () => ({
  useStorageMode: () => ({ mode: 'frontend', setMode: () => {} }),
}));

vi.mock('../../i18n', () => ({
  useTranslation: () => ({ t: (k: string) => k, locale: 'zh-CN', setLocale: () => {} }),
}));

const emptySegments: Segment[] = [];

afterEach(() => cleanup());

describe('ExportDialog defaultName', () => {
  it('reflects the current chapter title on every open (fresh mount)', () => {
    const { unmount } = render(
      <ExportDialog
        projectId="p1"
        chapterId="c1"
        segments={emptySegments}
        defaultName="第一章 · 序幕"
        onClose={() => {}}
      />,
    );

    const first = screen.getByRole('textbox') as HTMLInputElement;
    expect(first.value).toBe('第一章 · 序幕');
    unmount(); // dialog closed

    // User switched to another chapter, then reopened the dialog.
    render(
      <ExportDialog
        projectId="p1"
        chapterId="c2"
        segments={emptySegments}
        defaultName="第二章 · 相遇"
        onClose={() => {}}
      />,
    );

    const second = screen.getByRole('textbox') as HTMLInputElement;
    // Regression: previously the dialog was never unmounted, so useState kept the
    // old initial value. Now each open is a fresh mount and picks up the new title.
    expect(second.value).toBe('第二章 · 相遇');
  });
});
