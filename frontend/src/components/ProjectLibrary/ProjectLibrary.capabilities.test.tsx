import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Chapter } from '../../types';
import { ProjectLibrary } from './ProjectLibrary';
import { CapabilitiesContext } from '../../hooks/useCapabilities';
import { LOCAL_CAPABILITIES, type Capabilities } from '../../services/capabilities';

vi.mock('../../services/api', () => ({
  textSplitApi: {
    markdownDetect: vi.fn(),
    markdownSplit: vi.fn(),
  },
  segmentedProjectApi: {
    getProject: vi.fn(),
    batchCreateChapters: vi.fn(),
  },
}));

vi.mock('../../services/langgraph/threads', () => ({
  resolveWorkflowThread: vi.fn(),
}));

vi.mock('../../services/langgraph/client', () => ({
  agentClient: {},
}));

const WORKERS_CAPABILITIES: Capabilities = {
  deploy_target: 'workers',
  engines: ['edge_tts', 'mimo_tts'],
  clone_engines: ['mimo'],
  features: { speech_to_text: false, agent_workflow: false, backend_storage: false, direct_storage_upload: true },
};

function makeChapter(id: string): Chapter {
  const params = {
    engine: 'edge_tts' as const,
    edge_voice: 'zh-CN-YunxiNeural',
    edge_rate: '+0%',
    edge_volume: '+0%',
    language: 'Chinese',
    speed: 1,
    volume: 80,
    pitch: 1,
  };
  return {
    id,
    name: '第一章',
    original_text: '这是第一章完整旁白文本。',
    segments: [],
    voice: params,
    split_config: { delimiters: ['。'], mode: 'rule' },
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}

function renderLibrary(caps: Capabilities) {
  return render(
    <CapabilitiesContext.Provider value={caps}>
      <ProjectLibrary
        chapters={[makeChapter('ch-1')]}
        activeChapterId="ch-1"
        projectId="p1"
        projectName="测试项目"
        onSelectChapter={vi.fn()}
        onRenameChapter={vi.fn()}
        onUpdateChapterText={vi.fn()}
        onUpdateChapterDesignTitle={vi.fn()}
        onAddChapter={vi.fn()}
        onDeleteChapter={vi.fn()}
        onEnterStudio={vi.fn()}
      />
    </CapabilitiesContext.Provider>,
  );
}

describe('ProjectLibrary workflow entry gating', () => {
  it('shows the workflow trigger in local mode', () => {
    renderLibrary(LOCAL_CAPABILITIES);
    fireEvent.click(screen.getByRole('button', { name: '源文档' }));

    expect(screen.getByRole('button', { name: /生成旁白/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /知识视频/ })).toBeInTheDocument();
  });

  it('hides the workflow trigger when agent_workflow is unavailable, but the source view stays accessible', () => {
    renderLibrary(WORKERS_CAPABILITIES);
    fireEvent.click(screen.getByRole('button', { name: '源文档' }));

    // B4：无工作流能力时源文档视图仍可访问，仅工作流按钮隐藏
    expect(screen.getByPlaceholderText(/源文档内容|source/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /生成旁白/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /知识视频/ })).not.toBeInTheDocument();
  });
});
