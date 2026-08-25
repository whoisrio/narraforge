import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ModelConfig } from '../ModelConfig';
import { CapabilitiesContext } from '../../hooks/useCapabilities';
import { LOCAL_CAPABILITIES, type Capabilities } from '../../services/capabilities';

const getAllMock = vi.fn();

vi.mock('../../services/api', () => ({
  modelConfigApi: {
    getAll: (...args: unknown[]) => getAllMock(...args),
    update: vi.fn(),
    getPublicKey: vi.fn(),
  },
}));

vi.mock('../../components/Settings/AnimationRootSetting', () => ({
  AnimationRootSetting: () => null,
}));
vi.mock('../../components/Settings/NarrationGitSetting', () => ({
  NarrationGitSetting: () => null,
}));
vi.mock('../../components/Settings/PronunciationMapSetting', () => ({
  PronunciationMapSetting: () => null,
}));
vi.mock('../../components/ui/useToast', () => ({
  useToast: () => ({ error: vi.fn(), success: vi.fn() }),
}));

const WORKERS_CAPABILITIES: Capabilities = {
  deploy_target: 'workers',
  engines: ['edge_tts', 'mimo_tts'],
  clone_engines: ['mimo'],
  features: { speech_to_text: false, agent_workflow: false, backend_storage: false, direct_storage_upload: true },
};

const CONFIGS = {
  qwen_tts: { label: 'Qwen-TTS', icon: 'Q', fields: {} },
  mimo_tts: { label: 'MiMo-TTS', icon: 'M', fields: {} },
  llm: { label: 'LLM', icon: 'L', fields: {} },
};

function renderModelConfig(caps: Capabilities) {
  getAllMock.mockResolvedValue(CONFIGS);
  return render(
    <CapabilitiesContext.Provider value={caps}>
      <ModelConfig />
    </CapabilitiesContext.Provider>,
  );
}

describe('ModelConfig capabilities gating', () => {
  it('shows the qwen_tts provider in local mode', async () => {
    renderModelConfig(LOCAL_CAPABILITIES);
    await waitFor(() => expect(screen.getByText('Qwen-TTS')).toBeInTheDocument());
    expect(screen.getByText('MiMo-TTS')).toBeInTheDocument();
    expect(screen.getByText('LLM')).toBeInTheDocument();
  });

  it('hides the qwen_tts provider in workers mode', async () => {
    renderModelConfig(WORKERS_CAPABILITIES);
    await waitFor(() => expect(screen.getByText('MiMo-TTS')).toBeInTheDocument());
    expect(screen.queryByText('Qwen-TTS')).not.toBeInTheDocument();
    expect(screen.getByText('LLM')).toBeInTheDocument();
  });
});
