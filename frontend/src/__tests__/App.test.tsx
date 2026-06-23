import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import App from '../App';

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
  ProjectHub: ({ onOpenProject, onCreateProject }: { onOpenProject: (id: string) => void; onCreateProject: () => void }) => (
    <div data-testid="project-hub">
      <button type="button" onClick={() => onOpenProject('p-demo')}>打开项目卡片</button>
      <button type="button" onClick={onCreateProject}>新建项目</button>
    </div>
  ),
}));

vi.mock('../pages/TTSSynthesis', () => ({
  TTSSynthesis: ({ initialProjectId, hideProjectSidebar }: { initialProjectId?: string; hideProjectSidebar?: boolean }) => (
    <div data-testid="page-tts-synthesis">
      TTS Studio Page · {initialProjectId} · {hideProjectSidebar ? 'hide-sidebar' : 'show-sidebar'}
    </div>
  ),
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
  it('renders the global project hub with global navigation by default', () => {
    render(<App />);

    expect(screen.getByTestId('app-shell')).toBeInTheDocument();
    expect(screen.getByText('NarraForge')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /项目/ })[0]).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: /字幕识别/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /音色设计/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /设置/ })).toBeInTheDocument();
    expect(screen.getByTestId('project-hub')).toBeInTheDocument();
    expect(screen.queryByTestId('page-tts-synthesis')).not.toBeInTheDocument();
  });

  it('enters project workspace only after clicking a project card', async () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: /打开项目卡片/ }));

    expect(await screen.findByTestId('page-tts-synthesis')).toHaveTextContent('p-demo');
    expect(screen.getByTestId('page-tts-synthesis')).toHaveTextContent('hide-sidebar');
    expect(screen.queryByRole('button', { name: /字幕识别/ })).not.toBeInTheDocument();
  });

  it('returns from project workspace to global project hub via the brand', async () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: /打开项目卡片/ }));
    expect(await screen.findByTestId('page-tts-synthesis')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'NF' }));

    await waitFor(() => expect(screen.getByTestId('project-hub')).toBeInTheDocument());
  });

  it('switches global navigation destinations from the global hub', () => {
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: /音色设计/ }));
    expect(screen.getByRole('button', { name: /音色设计/ })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('page-voice-design')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: /字幕识别/ }));
    expect(screen.getByRole('button', { name: /字幕识别/ })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('page-subtitles')).toBeVisible();
  });
});
