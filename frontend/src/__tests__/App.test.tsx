import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import App from '../App';
import { indexedDBStorage } from '../services/segmentedProjectStorage';

vi.mock('../services/api', () => ({
  configApi: {
    getStorageMode: vi.fn(() => new Promise(() => {})),
    setStorageMode: vi.fn().mockResolvedValue({ storage_mode: 'frontend' }),
  },
}));

vi.mock('../services/segmentedProjectStorage', () => ({
  indexedDBStorage: {
    listProjects: vi.fn(() => new Promise(() => {})),
    getProject: vi.fn(),
    saveProject: vi.fn(),
    deleteProject: vi.fn(),
  },
}));

vi.mock('../services/backendSegmentedProjectStorage', () => ({
  backendStorage: {
    listProjects: vi.fn(() => new Promise(() => {})),
    getProject: vi.fn(),
    saveProject: vi.fn(),
    deleteProject: vi.fn(),
  },
}));

vi.mock('../components/ProjectHub/ProjectHub', () => ({
  ProjectHub: ({
    onOpenProject,
    onCreateProject,
    onDeleteProject,
    onRenameProject,
  }: {
    onOpenProject: (id: string) => void;
    onCreateProject: () => void;
    onDeleteProject: (id: string) => void;
    onRenameProject: (id: string, name: string) => void;
  }) => (
    <div data-testid="project-hub">
      <button type="button" onClick={() => onOpenProject('p-demo')}>打开项目卡片</button>
      <button type="button" onClick={onCreateProject}>新建项目</button>
      <button type="button" onClick={() => onDeleteProject('p-demo')}>删除项目卡片</button>
      <button type="button" onClick={() => onRenameProject('p-demo', '改名项目')}>重命名项目卡片</button>
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
  beforeEach(() => {
    vi.mocked(indexedDBStorage.deleteProject).mockResolvedValue(undefined);
    vi.mocked(indexedDBStorage.saveProject).mockResolvedValue(undefined);
    vi.mocked(indexedDBStorage.listProjects).mockReturnValue(new Promise(() => {}));
  });

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

  it('deletes a project from the global hub without entering the workspace', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.mocked(indexedDBStorage.listProjects).mockResolvedValue([]);

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: /删除项目卡片/ }));

    await waitFor(() => expect(indexedDBStorage.deleteProject).toHaveBeenCalledWith('p-demo'));
    expect(screen.getByTestId('project-hub')).toBeInTheDocument();
    expect(screen.queryByTestId('page-tts-synthesis')).not.toBeInTheDocument();
  });

  it('renames a project from the global hub without entering the workspace', async () => {
    vi.mocked(indexedDBStorage.getProject).mockResolvedValue({
      schema_version: 2,
      id: 'p-demo',
      name: '旧项目',
      active_chapter_id: 'ch-1',
      layout: 'vertical',
      chapters: [],
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    });
    vi.mocked(indexedDBStorage.listProjects).mockResolvedValue([]);

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: /重命名项目卡片/ }));

    await waitFor(() => expect(indexedDBStorage.saveProject).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'p-demo', name: '改名项目' }),
      { mode: 'immediate' },
    ));
    expect(screen.getByTestId('project-hub')).toBeInTheDocument();
    expect(screen.queryByTestId('page-tts-synthesis')).not.toBeInTheDocument();
  });
});
