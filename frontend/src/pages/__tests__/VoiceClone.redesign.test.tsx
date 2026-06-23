import { fireEvent, render, screen } from '@testing-library/react';
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

  it('provides deep Voice Profile Library, Design prompt, Tune controls, and backend preview action', () => {
    render(<VoiceClone />);

    fireEvent.click(screen.getByRole('button', { name: /音色设计/ }));

    expect(screen.getAllByText('Voice Profile Library').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Design Brief').length).toBeGreaterThan(0);
    expect(screen.getByLabelText('音色描述')).toBeInTheDocument();
    expect(screen.getAllByText('Tune Lab').length).toBeGreaterThan(0);
    expect(screen.getByLabelText('表现强度')).toBeInTheDocument();
    expect(screen.getByLabelText('稳定性')).toBeInTheDocument();
    expect(screen.getByText('后端试听')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('音色描述'), { target: { value: '温暖、沉稳、有纪录片感的中文男声' } });
    expect(screen.getAllByText(/温暖、沉稳/).length).toBeGreaterThan(0);
    expect(screen.getByText('可绑定到项目 Voice Role')).toBeInTheDocument();
  });
});
