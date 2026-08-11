import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('axios', () => ({
  default: { get: vi.fn() },
}));

import axios from 'axios';
import { fetchCapabilities, LOCAL_CAPABILITIES } from './capabilities';

afterEach(() => {
  vi.clearAllMocks();
});

describe('LOCAL_CAPABILITIES', () => {
  it('matches the local backend full-capability contract', () => {
    expect(LOCAL_CAPABILITIES).toEqual({
      deploy_target: 'local',
      engines: ['edge_tts', 'mimo_tts', 'cosyvoice', 'voxcpm'],
      clone_engines: ['qwen', 'mimo', 'voxcpm'],
      features: { speech_to_text: true, agent_workflow: true, backend_storage: true },
    });
  });
});

describe('fetchCapabilities', () => {
  it('requests /api/config/capabilities with credentials', async () => {
    vi.mocked(axios.get).mockResolvedValue({ data: LOCAL_CAPABILITIES });

    const result = await fetchCapabilities();

    expect(axios.get).toHaveBeenCalledWith('/api/config/capabilities', { withCredentials: true });
    expect(result).toEqual(LOCAL_CAPABILITIES);
  });
});
