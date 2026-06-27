import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VoiceClone } from '../../pages/VoiceClone';
import { voiceApi } from '../../services/api';
import type { VoiceProfile } from '../../types';

describe('VoiceClone Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should render voice design hub and method selection cards', () => {
    vi.spyOn(voiceApi, 'list').mockReturnValue(new Promise(() => {}));

    render(<VoiceClone />);

    expect(screen.getByRole('heading', { name: '音色设计' })).toBeInTheDocument();
    expect(screen.getByText('Voice Profiles')).toBeInTheDocument();
  });

  it('should show empty state when no cloned voices exist', async () => {
    vi.spyOn(voiceApi, 'list').mockResolvedValue([]);
    vi.spyOn(voiceApi, 'syncFromQwen').mockResolvedValue({
      message: '', synced: 0, updated: 0, total_qwen_voices: 0, results: [],
    });

    render(<VoiceClone />);

    await waitFor(() => {
      expect(screen.getByText(/还没有音色/)).toBeInTheDocument();
    });
  });

  it('should list cloned voices when data is available', async () => {
    const mockVoices: VoiceProfile[] = [
      {
        id: 'voice-1',
        name: '我的声音',
        audio_url: '/api/clone/audio/voice-1',
        qwen_voice_id: 'qwen-1',
        role: 'custom',
        clone_engine: 'qwen',
        is_cloned: true,
        cloned_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      },
    ];

    vi.spyOn(voiceApi, 'list').mockResolvedValue(mockVoices);
    vi.spyOn(voiceApi, 'syncFromQwen').mockResolvedValue({
      message: '', synced: 0, updated: 0, total_qwen_voices: 0, results: [],
    });

    render(<VoiceClone />);

    await waitFor(() => {
      expect(screen.getByText('我的声音')).toBeInTheDocument();
    });
  });
});
