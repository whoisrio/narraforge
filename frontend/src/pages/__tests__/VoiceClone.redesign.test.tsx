import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { VoiceClone } from '../VoiceClone';
import { playVoiceDesignPreview } from '../../services/voiceDesignPreview';

vi.mock('../../hooks/useVoiceRefresh', () => ({
  useVoiceRefresh: () => ({ triggerRefresh: vi.fn(), refreshCounter: 0 }),
}));

vi.mock('../../components/VoiceClone/AudioRecorder', () => ({ AudioRecorder: () => <div data-testid="audio-recorder" /> }));
vi.mock('../../components/VoiceClone/AudioUploader', () => ({ AudioUploader: () => <div data-testid="audio-uploader" /> }));
vi.mock('../../components/VoiceClone/AudioPreview', () => ({ AudioPreview: () => <div data-testid="audio-preview" /> }));
vi.mock('../../components/VoiceClone/UrlInput', () => ({ UrlInput: () => <div data-testid="url-input" /> }));
vi.mock('../../components/VoiceClone/VoiceList', () => ({ VoiceList: () => <div data-testid="voice-list" /> }));
vi.mock('../../services/voiceDesignPreview', () => ({
  playVoiceDesignPreview: vi.fn(),
}));

describe('VoiceClone redesign shell', () => {
  it('surfaces global Voice Design as reusable voice profile workspace', () => {
    render(<VoiceClone />);

    const title = screen.getByText('Voice Design');
    expect(title.closest('section')).toHaveAttribute('data-visual', 'thin-global-header');
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

  it('routes backend preview through the selected design engine and saves generated profiles to the library', async () => {
    vi.mocked(playVoiceDesignPreview).mockResolvedValue({
      audio_id: 'preview-1',
      audio_base64: 'abc',
      audio_format: 'mp3',
      text: 'preview',
      params: {},
    });

    render(<VoiceClone />);
    fireEvent.click(screen.getByRole('button', { name: /音色设计/ }));
    fireEvent.change(screen.getByLabelText('音色描述'), { target: { value: '低沉、可信、纪录片旁白男声' } });
    fireEvent.change(screen.getByLabelText('表现强度'), { target: { value: '82' } });
    fireEvent.change(screen.getByLabelText('稳定性'), { target: { value: '56' } });

    fireEvent.click(screen.getByRole('button', { name: '后端试听' }));

    await waitFor(() => expect(playVoiceDesignPreview).toHaveBeenCalledWith(expect.objectContaining({
      engine: 'mimo',
      voiceDescription: '低沉、可信、纪录片旁白男声',
      intensity: 82,
      stability: 56,
    })));
    expect(await screen.findByText(/试听已生成/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '保存为 Voice Profile' }));
    expect(screen.getAllByText('低沉、可信、纪录片旁白男声').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/MiMo\s*· design/).length).toBeGreaterThan(0);
  });
});
