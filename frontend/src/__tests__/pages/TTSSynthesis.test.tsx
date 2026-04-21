import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { TTSSynthesis } from '../../pages/TTSSynthesis';
import * as api from '../../services/api';

describe('TTSSynthesis Page', () => {
  it('should render page title and components', () => {
    render(<TTSSynthesis />);

    expect(screen.getByText('文字转语音')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/输入要合成的文字/)).toBeInTheDocument();
    expect(screen.getByText('参数设置')).toBeInTheDocument();
  });

  it('should call ttsApi.synthesize when generate button is clicked', async () => {
    const mockResult = {
      audio_id: 'test-123',
      audio_url: '/api/tts/audio/test-123',
      text: '测试文本',
      params: {
        speed: 1.0,
        volume: 80,
        pitch: 0,
        emotion: 'neutral',
      },
    };

    const ttsApiSpy = vi.spyOn(api, 'ttsApi', 'get').mockReturnValue({
      getVoices: vi.fn().mockResolvedValue({ default: [], cloned: [] }),
      synthesize: vi.fn().mockResolvedValue(mockResult),
      batch: vi.fn().mockResolvedValue({}),
    });

    render(<TTSSynthesis />);

    await waitFor(() => screen.getByPlaceholderText(/输入要合成的文字/));

    const textarea = screen.getByPlaceholderText(/输入要合成的文字/);
    fireEvent.change(textarea, { target: { value: '测试文本' } });

    const generateButton = screen.getByRole('button', { name: /生成语音/ });
    fireEvent.click(generateButton);

    expect(api.ttsApi.synthesize).toHaveBeenCalledWith(
      expect.objectContaining({
        text: '测试文本',
        voice_id: expect.any(String),
      })
    );
  });
});
