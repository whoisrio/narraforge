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
vi.mock('../../services/voiceDesignPreview', () => ({
  playVoiceDesignPreview: vi.fn(),
}));

describe('VoiceClone redesign shell', () => {
  it('renders Voice Design page with header', () => {
    render(<VoiceClone />);

    expect(screen.getByRole('heading', { name: '音色设计' })).toBeInTheDocument();
    expect(screen.getByText('音色档案')).toBeInTheDocument();
  });
});
