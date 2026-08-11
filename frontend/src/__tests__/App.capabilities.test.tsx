import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import App from '../App';
import type { Capabilities } from '../services/capabilities';

const WORKERS_CAPABILITIES = vi.hoisted((): Capabilities => ({
  deploy_target: 'workers',
  engines: ['edge_tts', 'mimo_tts'],
  clone_engines: ['mimo'],
  features: { speech_to_text: false, agent_workflow: false, backend_storage: false },
}));

vi.mock('../services/capabilities', async (importOriginal) => {
  const original = await importOriginal<typeof import('../services/capabilities')>();
  return {
    ...original,
    fetchCapabilities: vi.fn().mockResolvedValue(WORKERS_CAPABILITIES),
  };
});

vi.mock('../services/api', () => ({
  configApi: {
    getStorageMode: vi.fn().mockResolvedValue({ storage_mode: 'frontend' }),
    setStorageMode: vi.fn().mockResolvedValue({ storage_mode: 'frontend' }),
  },
}));

vi.mock('../services/segmentedProjectStorage', () => ({
  indexedDBStorage: {
    listProjects: vi.fn().mockResolvedValue([]),
    getProject: vi.fn(),
    saveProject: vi.fn(),
    deleteProject: vi.fn(),
  },
}));

vi.mock('../services/backendSegmentedProjectStorage', () => ({
  backendStorage: {
    listProjects: vi.fn().mockResolvedValue([]),
    getProject: vi.fn(),
    saveProject: vi.fn(),
    deleteProject: vi.fn(),
  },
}));

vi.mock('../components/ProjectHub/ProjectHub', () => ({
  ProjectHub: () => <div data-testid="project-hub" />,
}));

vi.mock('../pages/TTSSynthesis', () => ({
  TTSSynthesis: () => <div data-testid="page-tts-synthesis" />,
}));
vi.mock('../pages/VoiceClone', () => ({
  VoiceClone: () => <div data-testid="page-voice-design" />,
}));
vi.mock('../pages/SpeechToText', () => ({
  SpeechToText: () => <div data-testid="page-subtitles" />,
}));
vi.mock('../pages/ModelConfig', () => ({
  ModelConfig: () => <div data-testid="page-settings" />,
}));
vi.mock('../pages/Landing', () => ({
  default: ({ onNavigate }: { onNavigate: (tab: 'tts-synthesis') => void }) => {
    setTimeout(() => onNavigate('tts-synthesis'), 0);
    return <div data-testid="page-landing" />;
  },
}));

describe('App capabilities gating (workers)', () => {
  it('hides the speech-to-text nav entry and the backend storage option', async () => {
    render(<App />);

    expect(await screen.findByTestId('app-shell')).toBeInTheDocument();
    // workers 无 speech_to_text：全局导航不给出字幕识别入口
    expect(screen.queryByRole('button', { name: /字幕识别/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /音色设计/ })).toBeInTheDocument();
    // workers 固定 frontend 存储：切换器不给出 backend 选项
    expect(screen.queryByRole('option', { name: /后端|backend/i })).not.toBeInTheDocument();
  });
});
