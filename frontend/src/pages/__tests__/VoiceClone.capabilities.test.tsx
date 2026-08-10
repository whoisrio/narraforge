import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { VoiceClone } from '../VoiceClone';
import { CapabilitiesContext } from '../../hooks/useCapabilities';
import { LOCAL_CAPABILITIES, type Capabilities } from '../../services/capabilities';

vi.mock('../../hooks/useVoiceRefresh', () => ({
  useVoiceRefresh: () => ({ triggerRefresh: vi.fn(), refreshCounter: 0 }),
}));

vi.mock('../../components/VoiceClone/AudioRecorder', () => ({ AudioRecorder: () => <div data-testid="audio-recorder" /> }));
vi.mock('../../components/VoiceClone/AudioUploader', () => ({ AudioUploader: () => <div data-testid="audio-uploader" /> }));
vi.mock('../../components/VoiceClone/AudioPreview', () => ({ AudioPreview: () => <div data-testid="audio-preview" /> }));
vi.mock('../../components/VoiceClone/UrlInput', () => ({ UrlInput: () => <div data-testid="url-input" /> }));
vi.mock('../../services/voiceDesignPreview', () => ({
  playVoiceDesignPreview: vi.fn(),
}));

const WORKERS_CAPABILITIES: Capabilities = {
  deploy_target: 'workers',
  engines: ['edge_tts', 'mimo_tts'],
  clone_engines: ['mimo'],
  features: { speech_to_text: false, agent_workflow: false, backend_storage: false },
};

function renderVoiceClone(caps: Capabilities) {
  return render(
    <CapabilitiesContext.Provider value={caps}>
      <VoiceClone />
    </CapabilitiesContext.Provider>,
  );
}

describe('VoiceClone capabilities gating', () => {
  it('offers qwen/mimo/voxcpm clone engines in local mode', () => {
    renderVoiceClone(LOCAL_CAPABILITIES);
    fireEvent.click(screen.getByRole('button', { name: '克隆声音' }));

    expect(screen.getByRole('button', { name: 'CosyVoice' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'MiMo-TTS' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'VoxCPM' })).toBeInTheDocument();
  });

  it('filters clone engine options by clone_engines in workers mode', () => {
    renderVoiceClone(WORKERS_CAPABILITIES);
    fireEvent.click(screen.getByRole('button', { name: '克隆声音' }));

    expect(screen.getByRole('button', { name: 'MiMo-TTS' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'CosyVoice' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'VoxCPM' })).not.toBeInTheDocument();
  });

  it('hides the voxcpm design engine in workers mode', () => {
    renderVoiceClone(WORKERS_CAPABILITIES);
    fireEvent.click(screen.getByRole('button', { name: '设计新音色' }));

    expect(screen.getByRole('button', { name: 'MiMo-TTS' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /VoxCPM/ })).not.toBeInTheDocument();
  });

  it('offers the voxcpm design engine in local mode', () => {
    renderVoiceClone(LOCAL_CAPABILITIES);
    fireEvent.click(screen.getByRole('button', { name: '设计新音色' }));

    expect(screen.getByRole('button', { name: /VoxCPM/ })).toBeInTheDocument();
  });
});
