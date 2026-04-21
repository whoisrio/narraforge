import { render, screen, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VoiceClone } from '../../pages/VoiceClone';
import * as api from '../../services/api';

describe('VoiceClone Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render page title and sections', () => {
    render(<VoiceClone />);

    expect(screen.getByText('声音克隆')).toBeInTheDocument();
    expect(screen.getByText('录制音频')).toBeInTheDocument();
    expect(screen.getByText('上传音频')).toBeInTheDocument();
  });

  it('should display cloned voices after loading', async () => {
    const mockVoices = [
      {
        id: 'voice-1',
        name: '我的声音',
        audio_url: '/api/clone/audio/voice-1',
        qwen_voice_id: 'qwen-1',
        is_cloned: true,
        created_at: new Date().toISOString(),
      },
    ];

    vi.spyOn(api, 'voiceApi', 'get').mockReturnValue({
      listCloned: vi.fn().mockResolvedValue(mockVoices),
      upload: vi.fn().mockResolvedValue(mockVoices[0]),
      list: vi.fn().mockResolvedValue(mockVoices),
      delete: vi.fn().mockResolvedValue(undefined),
      syncFromQwen: vi.fn().mockResolvedValue({}),
      synthesize: vi.fn().mockResolvedValue({}),
    });

    render(<VoiceClone />);

    await waitFor(() => {
      expect(screen.getByText('添加新声音')).toBeInTheDocument();
    });
  });

  it('should render the page structure correctly', async () => {
    vi.spyOn(api, 'voiceApi', 'get').mockReturnValue({
      listCloned: vi.fn().mockResolvedValue([]),
      upload: vi.fn().mockResolvedValue({}),
      list: vi.fn().mockResolvedValue([]),
      delete: vi.fn().mockResolvedValue(undefined),
      syncFromQwen: vi.fn().mockResolvedValue({}),
      synthesize: vi.fn().mockResolvedValue({}),
    });

    render(<VoiceClone />);

    await waitFor(() => {
      expect(screen.getByText('声音克隆')).toBeInTheDocument();
      expect(screen.getByText('添加新声音')).toBeInTheDocument();
    });
  });
});
