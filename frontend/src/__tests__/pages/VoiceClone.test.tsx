import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VoiceClone } from '../../pages/VoiceClone';
import * as api from '../../services/api';

describe('VoiceClone Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render page title and method selection cards', () => {
    render(<VoiceClone />);

    expect(screen.getByText('声音复刻')).toBeInTheDocument();
    expect(screen.getByText('完美复刻你的声音')).toBeInTheDocument();
    expect(screen.getByText('实时录制')).toBeInTheDocument();
    expect(screen.getByText('上传文件')).toBeInTheDocument();
    expect(screen.getByText('公网地址')).toBeInTheDocument();
  });

  it('should show empty state when no cloned voices exist', async () => {
    vi.spyOn(api.voiceApi, 'list').mockResolvedValue([]);
    vi.spyOn(api.voiceApi, 'syncFromQwen').mockResolvedValue({
      message: '', synced: 0, updated: 0, total_qwen_voices: 0, results: [],
    });

    render(<VoiceClone />);

    await waitFor(() => {
      expect(screen.getByText('No Voices Yet')).toBeInTheDocument();
    });
  });

  it('should list cloned voices when data is available', async () => {
    const mockVoices = [
      {
        id: 'voice-1',
        name: '我的声音',
        audio_url: '/api/clone/audio/voice-1',
        qwen_voice_id: 'qwen-1',
        role: 'custom',
        is_cloned: true,
        cloned_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      },
    ];

    vi.spyOn(api.voiceApi, 'list').mockResolvedValue(mockVoices);
    vi.spyOn(api.voiceApi, 'syncFromQwen').mockResolvedValue({
      message: '', synced: 0, updated: 0, total_qwen_voices: 0, results: [],
    });

    render(<VoiceClone />);

    // 有数据时应显示 Cloned Voice 区域，VoiceList 显示 voice.description || voice.qwen_voice_id
    await waitFor(() => {
      expect(screen.getByText('🎤 Cloned Voices')).toBeInTheDocument();
    });

    // 每个声音卡片都应有独立的 Delete 按钮
    expect(screen.getAllByText('Delete')).toHaveLength(mockVoices.length);
  });
});