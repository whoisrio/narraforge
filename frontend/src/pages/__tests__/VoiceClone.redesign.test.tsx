import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { VoiceClone } from '../VoiceClone';

vi.mock('../../hooks/useVoiceRefresh', () => ({
  useVoiceRefresh: () => ({ triggerRefresh: vi.fn(), refreshCounter: 0 }),
}));

vi.mock('../../components/VoiceClone/AudioRecorder', () => ({ AudioRecorder: () => <div data-testid="audio-recorder" /> }));
vi.mock('../../components/VoiceClone/AudioUploader', () => ({ AudioUploader: () => <div data-testid="audio-uploader" /> }));
vi.mock('../../components/VoiceClone/AudioPreview', () => ({ AudioPreview: () => <div data-testid="audio-preview" /> }));
vi.mock('../../components/VoiceClone/UrlInput', () => ({ UrlInput: () => <div data-testid="url-input" /> }));
vi.mock('../../components/VoiceClone/VoiceList', () => ({ VoiceList: () => <div data-testid="voice-list" /> }));

describe('VoiceClone redesign shell', () => {
  it('surfaces global Voice Design as reusable voice profile workspace', () => {
    render(<VoiceClone />);

    expect(screen.getByText('Voice Design')).toBeInTheDocument();
    expect(screen.getByText('Voice Profile Library')).toBeInTheDocument();
    expect(screen.getByText('Clone / Design / Tune')).toBeInTheDocument();
    expect(screen.getByText('Project Role Ready')).toBeInTheDocument();
    expect(screen.getByTestId('voice-list')).toBeInTheDocument();
  });
});
