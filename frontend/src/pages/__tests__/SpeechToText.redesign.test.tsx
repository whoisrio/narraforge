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
  AudioDropzone: ({ files, onTranscribe, processing }: { files: File[]; onTranscribe: () => void; processing: boolean }) => (
    <div data-testid="audio-dropzone">
      <span>{files.length} files</span>
      <button onClick={onTranscribe} disabled={processing || files.length === 0}>
        {processing ? '识别中...' : '开始识别'}
      </button>
    </div>
  ),
  TranscriptEditor: () => <div data-testid="transcript-editor" />,
  CorrectionPanel: () => <div data-testid="correction-panel" />,
  SidebarConfig: () => <div data-testid="sidebar-config" />,
  ExportPanel: () => <div data-testid="export-panel" />,
  BilingualCard: () => <div data-testid="bilingual-card" />,
  QualityReport: () => <div data-testid="quality-report" />,
  PlaybackBar: () => <div data-testid="playback-bar" />,
}));

describe('SpeechToText redesigned layout', () => {
  it('renders the two-column Transcription Hub layout with all sections', () => {
    render(<SpeechToText />);

    expect(screen.getByText('Transcription Hub')).toBeInTheDocument();
    expect(screen.getByText('Convert spoken narrative into polished prose.')).toBeInTheDocument();
    expect(screen.getByTestId('audio-dropzone')).toBeInTheDocument();
    expect(screen.getByTestId('transcript-editor')).toBeInTheDocument();
    expect(screen.getByTestId('correction-panel')).toBeInTheDocument();
    expect(screen.getByTestId('sidebar-config')).toBeInTheDocument();
    expect(screen.getByTestId('export-panel')).toBeInTheDocument();
    expect(screen.getByTestId('bilingual-card')).toBeInTheDocument();
    expect(screen.getByTestId('playback-bar')).toBeInTheDocument();
    expect(screen.getByTestId('transcription-history')).toBeInTheDocument();
  });

  it('renders without boundary timeline or source mode switch', () => {
    render(<SpeechToText />);
    expect(screen.queryByText('Boundary Timeline')).not.toBeInTheDocument();
    expect(screen.queryByText('Boundary Map')).not.toBeInTheDocument();
    expect(screen.queryByText('单文件')).not.toBeInTheDocument();
    expect(screen.queryByText('素材导入')).not.toBeInTheDocument();
  });
});
