import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SpeechToText } from '../SpeechToText';
import { speechToTextApi } from '../../services/api';

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

  it('queues local subtitle files, reorders them, transcribes unified ASR, shows boundary map, and exports JSON/TXT', async () => {
    vi.mocked(speechToTextApi.multiTranscribe).mockResolvedValue({
      file_id: 'merged-1',
      filename: 'merged_audio.srt',
      content: '1\n00:00:00,000 --> 00:00:01,000\n你好\n',
      language: 'zh',
      language_probability: 0.98,
      download_url: '/api/speech-to-text/download/merged-1',
    });
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:subtitle-export');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const click = vi.fn();
    const appendChild = vi.spyOn(document.body, 'appendChild');
    const removeChild = vi.spyOn(document.body, 'removeChild');
    const createElement = vi.spyOn(document, 'createElement');
    createElement.mockImplementation(((tagName: string) => {
      const element = document.createElementNS('http://www.w3.org/1999/xhtml', tagName) as HTMLElement;
      if (tagName.toLowerCase() === 'a') {
        Object.assign(element, { click });
      }
      return element;
    }) as typeof document.createElement);

    render(<SpeechToText />);

    const fileInput = screen.getByLabelText('选择多文件队列') as HTMLInputElement;
    const first = new File(['a'], 'part-a.mp3', { type: 'audio/mpeg' });
    const second = new File(['b'], 'part-b.wav', { type: 'audio/wav' });
    fireEvent.change(fileInput, { target: { files: [first, second] } });

    expect(screen.getAllByText('part-a.mp3').length).toBeGreaterThan(0);
    expect(screen.getAllByText('part-b.wav').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: '上移 part-b.wav' }));
    fireEvent.click(screen.getByRole('button', { name: /统一 ASR/ }));

    await waitFor(() => expect(speechToTextApi.multiTranscribe).toHaveBeenCalledWith([second, first], 'large-v3', 5, 'whisper', true));
    expect(screen.getByText('Boundary Map')).toBeInTheDocument();
    expect(screen.getAllByText(/part-b\.wav/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/part-a\.mp3/).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: '导出 JSON' }));
    expect(click).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '导出 TXT' }));
    expect(click).toHaveBeenCalledTimes(2);

    createObjectURL.mockRestore();
    revokeObjectURL.mockRestore();
    appendChild.mockRestore();
    removeChild.mockRestore();
    createElement.mockRestore();
  });
});
