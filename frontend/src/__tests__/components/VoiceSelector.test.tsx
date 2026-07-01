import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { VoiceSelector } from '../../components/TTSSynthesis/VoiceSelector';
import { ttsApi } from '../../services/api';
import type { VoiceProfile } from '../../types';

describe('VoiceSelector', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should render loading state initially', () => {
    vi.spyOn(ttsApi, 'getVoices').mockReturnValue(new Promise(() => {}));

    render(<VoiceSelector selectedVoiceId="" onVoiceSelect={() => {}} />);

    expect(screen.getByText('加载声音列表...')).toBeInTheDocument();
  });

  it('should display cloned voices after loading', async () => {
    const mockVoices: VoiceProfile[] = [
      { id: 'xiaoyun', name: '云溪', description: '云溪', voice: { model: 'cosyvoice', voice_type: 'clone' }, voice_params: { cosyvoice: { params: { voice_id: 'qwen-xiaoyun' } } }, audio_url: '/voices/xiaoyun.mp3', created_at: '2026-01-01T00:00:00.000Z' },
      { id: 'xiaogang', name: '小刚', description: '小刚', voice: { model: 'cosyvoice', voice_type: 'clone' }, voice_params: { cosyvoice: { params: { voice_id: 'qwen-xiaogang' } } }, audio_url: '/voices/xiaogang.mp3', created_at: '2026-01-01T00:00:00.000Z' },
    ];

    vi.spyOn(ttsApi, 'getVoices').mockResolvedValue(mockVoices);

    render(<VoiceSelector selectedVoiceId="" onVoiceSelect={() => {}} />);

    await waitFor(() => {
      expect(screen.getByRole('option', { name: /云溪/ })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: /小刚/ })).toBeInTheDocument();
    });
  });

  it('should call onVoiceSelect when a voice is selected', async () => {
    const mockVoices: VoiceProfile[] = [
      { id: 'xiaoyun', name: '云溪', description: '云溪', voice: { model: 'cosyvoice', voice_type: 'clone' }, voice_params: { cosyvoice: { params: { voice_id: 'qwen-xiaoyun' } } }, audio_url: '/voices/xiaoyun.mp3', created_at: '2026-01-01T00:00:00.000Z' },
    ];

    vi.spyOn(ttsApi, 'getVoices').mockResolvedValue(mockVoices);

    const onSelect = vi.fn();

    render(<VoiceSelector selectedVoiceId="" onVoiceSelect={onSelect} />);

    const select = await screen.findByTestId('voice-select');
    fireEvent.change(select, { target: { value: 'qwen-xiaoyun' } });

    expect(onSelect).toHaveBeenCalledWith('qwen-xiaoyun');
  });
});
