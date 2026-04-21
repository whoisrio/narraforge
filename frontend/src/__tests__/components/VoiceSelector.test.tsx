import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { VoiceSelector } from '../../components/TTSSynthesis/VoiceSelector';
import * as api from '../../services/api';

describe('VoiceSelector', () => {
  it('should render loading state initially', () => {
    render(<VoiceSelector selectedVoiceId="" onVoiceSelect={() => {}} />);

    expect(screen.getByText('加载声音列表...')).toBeInTheDocument();
  });

  it('should display default voices after loading', async () => {
    const mockVoices = {
      default: [
        { id: 'xiaoyun', name: '云溪', gender: 'female' },
        { id: 'xiaogang', name: '小刚', gender: 'male' },
      ],
      cloned: [],
    };

    vi.spyOn(api, 'ttsApi', 'get').mockReturnValue({
      getVoices: vi.fn().mockResolvedValue(mockVoices),
    } as any);

    render(<VoiceSelector selectedVoiceId="" onVoiceSelect={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText('默认声音')).toBeInTheDocument();
      expect(screen.getByText('云溪')).toBeInTheDocument();
      expect(screen.getByText('小刚')).toBeInTheDocument();
    });
  });

  it('should call onVoiceSelect when a voice is clicked', async () => {
    const mockVoices = {
      default: [{ id: 'xiaoyun', name: '云溪', gender: 'female' }],
      cloned: [],
    };

    vi.spyOn(api, 'ttsApi', 'get').mockReturnValue({
      getVoices: vi.fn().mockResolvedValue(mockVoices),
    } as any);

    const onSelect = vi.fn();

    render(<VoiceSelector selectedVoiceId="" onVoiceSelect={onSelect} />);

    await waitFor(() => screen.getByText('云溪'));

    fireEvent.click(screen.getByText('云溪'));

    expect(onSelect).toHaveBeenCalledWith('xiaoyun', false);
  });
});
