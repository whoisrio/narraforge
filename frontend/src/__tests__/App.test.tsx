import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import App from '../App';

vi.mock('../pages/TTSSynthesis', () => ({
  TTSSynthesis: () => <div data-testid="page-tts-synthesis">TTS Studio Page</div>,
}));

vi.mock('../pages/VoiceClone', () => ({
  VoiceClone: () => <div data-testid="page-voice-design">Voice Design Page</div>,
}));

vi.mock('../pages/SpeechToText', () => ({
  SpeechToText: () => <div data-testid="page-subtitles">Subtitles Page</div>,
}));

vi.mock('../pages/ModelConfig', () => ({
  ModelConfig: () => <div data-testid="page-settings">Settings Page</div>,
}));

describe('App', () => {
  it('renders the new studio shell with global navigation', () => {
    render(<App />);

    expect(screen.getByTestId('app-shell')).toBeInTheDocument();
    expect(screen.getByText('NarraForge')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /项目/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /字幕识别/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /音色设计/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /设置/ })).toBeInTheDocument();
  });

  it('shows the project TTS studio by default', () => {
    render(<App />);

    expect(screen.getByRole('button', { name: /项目/ })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('page-tts-synthesis')).toBeVisible();
  });

  it('switches global navigation destinations', () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: /音色设计/ }));
    expect(screen.getByRole('button', { name: /音色设计/ })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('page-voice-design')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: /字幕识别/ }));
    expect(screen.getByRole('button', { name: /字幕识别/ })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('page-subtitles')).toBeVisible();
  });
});
