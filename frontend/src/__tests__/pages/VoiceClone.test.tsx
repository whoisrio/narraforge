import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VoiceClone } from '../../pages/VoiceClone';
import { voiceApi } from '../../services/api';
import type { VoiceProfile } from '../../types';

const mockSync = {
  message: '', synced: 0, updated: 0, total_qwen_voices: 0, results: [],
};

describe('VoiceClone Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(voiceApi, 'syncFromQwen').mockResolvedValue(mockSync);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should render voice design hub and method selection cards', () => {
    vi.spyOn(voiceApi, 'list').mockReturnValue(new Promise(() => {}));

    render(<VoiceClone />);

    expect(screen.getByRole('heading', { name: '音色设计' })).toBeInTheDocument();
    expect(screen.getByText('音色档案')).toBeInTheDocument();
  });

  it('should show empty state when no cloned voices exist', async () => {
    vi.spyOn(voiceApi, 'list').mockResolvedValue([]);

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
        voice: { model: 'cosyvoice', voice_type: 'clone' },
        voice_params: { cosyvoice: { params: { voice_id: 'qwen-1' } } },
        created_at: new Date().toISOString(),
      },
    ];

    vi.spyOn(voiceApi, 'list').mockResolvedValue(mockVoices);

    render(<VoiceClone />);

    await waitFor(() => {
      expect(screen.getByText('我的声音')).toBeInTheDocument();
    });
  });

  it('should display input method label on voice cards', async () => {
    const mockVoices: VoiceProfile[] = [
      {
        id: 'voice-upload',
        name: '上传声音',
        audio_url: '/api/clone/audio/voice-upload',
        voice: { model: 'mimo_tts', voice_type: 'clone' },
        voice_params: { mimo_tts: { params: { input_method: 'upload' } } },
        created_at: new Date().toISOString(),
      },
    ];

    vi.spyOn(voiceApi, 'list').mockResolvedValue(mockVoices);

    render(<VoiceClone />);

    await waitFor(() => {
      expect(screen.getByText('上传声音')).toBeInTheDocument();
    });
    expect(screen.getByText('上传')).toBeInTheDocument();
  });

  it('should display edit and delete buttons on voice cards', async () => {
    const mockVoices: VoiceProfile[] = [
      {
        id: 'voice-1',
        name: '测试声音',
        audio_url: '/api/clone/audio/voice-1',
        voice: { model: 'cosyvoice', voice_type: 'clone' },
        voice_params: { cosyvoice: { params: {} } },
        created_at: new Date().toISOString(),
      },
    ];

    vi.spyOn(voiceApi, 'list').mockResolvedValue(mockVoices);

    render(<VoiceClone />);

    await waitFor(() => {
      expect(screen.getByText('测试声音')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /编辑/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /删除/ })).toBeInTheDocument();
  });

  it('should open edit panel when clicking edit button', async () => {
    const mockVoices: VoiceProfile[] = [
      {
        id: 'voice-1',
        name: '编辑测试',
        audio_url: '/api/clone/audio/voice-1',
        voice: { model: 'mimo_tts', voice_type: 'clone' },
        voice_params: { mimo_tts: { params: {} } },
        created_at: new Date().toISOString(),
        source_audio_url: '/api/clone/audio/voice-1?field=original',
        preview_audio_url: '/api/clone/audio/voice-1?field=preview',
      },
    ];

    vi.spyOn(voiceApi, 'list').mockResolvedValue(mockVoices);

    render(<VoiceClone />);

    await waitFor(() => {
      expect(screen.getByText('编辑测试')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /编辑/ }));

    // Edit panel should show existing audio and retake buttons
    expect(screen.getByText('原始音频')).toBeInTheDocument();
    expect(screen.getByText('克隆试听')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /重新录制/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /重新上传/ })).toBeInTheDocument();
  });

  it('should call delete API when clicking delete button', async () => {
    const mockVoices: VoiceProfile[] = [
      {
        id: 'voice-del',
        name: '删除测试',
        audio_url: '/api/clone/audio/voice-del',
        voice: { model: 'cosyvoice', voice_type: 'clone' },
        voice_params: { cosyvoice: { params: {} } },
        created_at: new Date().toISOString(),
      },
    ];

    vi.spyOn(voiceApi, 'list').mockResolvedValue(mockVoices);
    vi.spyOn(voiceApi, 'delete').mockResolvedValue(undefined);

    render(<VoiceClone />);

    await waitFor(() => {
      expect(screen.getByText('删除测试')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /删除/ }));

    await waitFor(() => {
      expect(voiceApi.delete).toHaveBeenCalledWith('voice-del');
    });
  });
});
