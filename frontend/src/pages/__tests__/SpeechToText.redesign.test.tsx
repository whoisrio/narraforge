import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SpeechToText } from '../SpeechToText';

vi.mock('../../hooks/useStorageMode', () => ({
  useStorageMode: () => ({ mode: 'frontend' }),
}));

vi.mock('../../services/indexedDB', () => ({
  saveSTTResult: vi.fn(),
  getSTTHistory: vi.fn(() => new Promise(() => {})),
  deleteSTTResult: vi.fn(),
}));

vi.mock('../../services/api', () => ({
  speechToTextApi: {
    transcribe: vi.fn(),
    multiTranscribe: vi.fn(),
    getHistory: vi.fn().mockResolvedValue([]),
    deleteRecord: vi.fn(),
  },
  subtitleLlmApi: {
    correct: vi.fn(),
    translate: vi.fn(),
  },
}));

vi.mock('../../components/SpeechToText', () => ({
  TranscriptionHistory: () => <div data-testid="transcription-history" />,
  MultiAudioSelector: () => <div data-testid="multi-audio-selector">多文件队列</div>,
}));

describe('SpeechToText redesign shell', () => {
  it('surfaces a global subtitle hub for multi-file unified ASR workflow', () => {
    render(<SpeechToText />);

    expect(screen.getByText('Subtitle Hub')).toBeInTheDocument();
    expect(screen.getByText('多文件拼接')).toBeInTheDocument();
    expect(screen.getByText('统一 ASR Timeline')).toBeInTheDocument();
    expect(screen.getByText('SRT / TXT / JSON')).toBeInTheDocument();
    expect(screen.getByTestId('multi-audio-selector')).toBeInTheDocument();
  });
});
