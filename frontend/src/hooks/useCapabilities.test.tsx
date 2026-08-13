import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LOCAL_CAPABILITIES, type Capabilities } from '../services/capabilities';

const fetchCapabilitiesMock = vi.fn();

vi.mock('../services/capabilities', async (importOriginal) => {
  const original = await importOriginal<typeof import('../services/capabilities')>();
  return { ...original, fetchCapabilities: (...args: unknown[]) => fetchCapabilitiesMock(...args) };
});

import { CapabilitiesProvider } from './CapabilitiesProvider';
import { useCapabilities } from './useCapabilities';

const WORKERS_CAPABILITIES: Capabilities = {
  deploy_target: 'workers',
  engines: ['edge_tts', 'mimo_tts'],
  clone_engines: ['mimo'],
  features: { speech_to_text: false, agent_workflow: false, backend_storage: false, direct_storage_upload: true },
};

function Probe() {
  const caps = useCapabilities();
  return <output data-testid="caps">{JSON.stringify(caps)}</output>;
}

afterEach(() => {
  fetchCapabilitiesMock.mockReset();
});

describe('useCapabilities', () => {
  it('falls back to full local capabilities when no provider is present', () => {
    render(<Probe />);
    expect(JSON.parse(screen.getByTestId('caps').textContent!)).toEqual(LOCAL_CAPABILITIES);
  });

  it('provides fetched workers capabilities', async () => {
    fetchCapabilitiesMock.mockResolvedValue(WORKERS_CAPABILITIES);
    render(
      <CapabilitiesProvider>
        <Probe />
      </CapabilitiesProvider>,
    );
    await waitFor(() => {
      expect(JSON.parse(screen.getByTestId('caps').textContent!)).toEqual(WORKERS_CAPABILITIES);
    });
  });

  it('keeps local defaults when fetching fails (本地开发体验不变)', async () => {
    fetchCapabilitiesMock.mockRejectedValue(new Error('network down'));
    render(
      <CapabilitiesProvider>
        <Probe />
      </CapabilitiesProvider>,
    );
    await waitFor(() => expect(fetchCapabilitiesMock).toHaveBeenCalled());
    expect(JSON.parse(screen.getByTestId('caps').textContent!)).toEqual(LOCAL_CAPABILITIES);
  });

  it('keeps local defaults on malformed payloads', async () => {
    fetchCapabilitiesMock.mockResolvedValue('<html>not json</html>');
    render(
      <CapabilitiesProvider>
        <Probe />
      </CapabilitiesProvider>,
    );
    await waitFor(() => expect(fetchCapabilitiesMock).toHaveBeenCalled());
    expect(JSON.parse(screen.getByTestId('caps').textContent!)).toEqual(LOCAL_CAPABILITIES);
  });
});
