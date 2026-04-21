import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { AudioPlayer } from '../../components/TTSSynthesis/AudioPlayer';
import type { TTSResult } from '../../types';

describe('AudioPlayer', () => {
  const mockResult: TTSResult = {
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

  it('should render loading state when isLoading is true', () => {
    render(<AudioPlayer result={null} isLoading={true} />);

    expect(screen.getByText('正在生成语音...')).toBeInTheDocument();
  });

  it('should render empty state when no result and not loading', () => {
    render(<AudioPlayer result={null} isLoading={false} />);

    expect(screen.getByText(/输入文字并点击.*生成语音.*开始/)).toBeInTheDocument();
  });

  it('should render audio player when result is provided', () => {
    const { container } = render(<AudioPlayer result={mockResult} isLoading={false} />);

    expect(screen.getByText('生成结果')).toBeInTheDocument();
    expect(container.querySelector('audio')).toBeInTheDocument();
    expect(screen.getByText('下载音频')).toBeInTheDocument();
  });
});
