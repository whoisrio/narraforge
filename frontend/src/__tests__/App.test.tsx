import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import App from '../App';

describe('App', () => {
  it('should render tab navigation with two tabs', () => {
    render(<App />);

    expect(screen.getByTestId('tab-voice-clone')).toBeInTheDocument();
    expect(screen.getByTestId('tab-tts-synthesis')).toBeInTheDocument();
  });

  it('should show VoiceClone tab by default', () => {
    render(<App />);

    const voiceCloneTab = screen.getByTestId('tab-voice-clone');
    expect(voiceCloneTab.className).toContain('active');
  });

  it('should switch to TTSSynthesis tab when clicked', () => {
    render(<App />);

    const voiceCloneTab = screen.getByTestId('tab-voice-clone');
    const ttsTab = screen.getByTestId('tab-tts-synthesis');

    fireEvent.click(ttsTab);

    expect(voiceCloneTab.className).not.toContain('active');
    expect(ttsTab.className).toContain('active');
  });
});
