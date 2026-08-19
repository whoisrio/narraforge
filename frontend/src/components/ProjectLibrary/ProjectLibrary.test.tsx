import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Chapter } from '../../types';
import { ProjectLibrary } from './ProjectLibrary';

const markdownDetect = vi.fn();
const markdownSplit = vi.fn();
const batchCreateChapters = vi.fn();
vi.mock('../../services/api', () => ({
  textSplitApi: {
    markdownDetect: (...a: unknown[]) => markdownDetect(...a),
    markdownSplit: (...a: unknown[]) => markdownSplit(...a),
  },
  segmentedProjectApi: {
    getProject: vi.fn(),
    batchCreateChapters: (...a: unknown[]) => batchCreateChapters(...a),
  },
}));

vi.mock('../../services/langgraph/threads', () => ({
  resolveWorkflowThread: vi.fn(),
}));

vi.mock('../../services/langgraph/client', () => ({
  agentClient: {},
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  localStorage.clear();
});

const baseParams = {
  engine: 'edge_tts' as const,
  edge_voice: 'zh-CN-YunxiNeural',
  edge_rate: '+0%',
  edge_volume: '+0%',
  language: 'Chinese',
  speed: 1,
  volume: 80,
  pitch: 1,
};

function makeChapter(id: string, name: string, originalText: string, segments = 0): Chapter {
  return {
    id,
    name,
    original_text: originalText,
    design_title: `${name} 视觉标题`,
    segments: Array.from({ length: segments }, (_, index) => ({
      id: `${id}-s-${index}`,
      text: `segment ${index}`,
      voice: { source: 'chapter' as const },
      audio: { format: 'mp3', duration_sec: index % 2 === 0 ? 6 : undefined },
      segment_kind: 'narration' as const,
      params: baseParams,
      status: index % 2 === 0 ? 'ready' : 'idle',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    })),
    voice: baseParams,
    split_config: { delimiters: ['。'], mode: 'rule' },
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}

function renderLibrary(overrides: Partial<Parameters<typeof ProjectLibrary>[0]> = {}) {
  return render(
    <ProjectLibrary
      chapters={[makeChapter('ch-1', '第一章', '这是第一章完整旁白文本。', 3), makeChapter('ch-2', '第二章', '这是第二章完整旁白文本。', 1)]}
      activeChapterId="ch-1"
      onSelectChapter={vi.fn()}
      onRenameChapter={vi.fn()}
      onUpdateChapterText={vi.fn()}
      onUpdateChapterDesignTitle={vi.fn()}
      onAddChapter={vi.fn()}
      onDeleteChapter={vi.fn()}
      onEnterStudio={vi.fn()}
      {...overrides}
    />,
  );
}

/** B1：默认落 doc 视图（全文），切换器三态 [全文 | 章节 | 源文档]，分镜入口已移除 */
describe('ProjectLibrary view IA (B1)', () => {
  it('defaults to the doc view with the three-way switcher; storyboard entry is gone', () => {
    renderLibrary({ narrationScript: '## 标题\n\n正文内容' });

    // 默认 doc 视图（形态 B：有 narration_script -> 拆分按钮可见）
    expect(screen.getByRole('button', { name: '按标题拆分章节' })).toBeInTheDocument();
    // 切换器三键
    expect(screen.getByRole('button', { name: '全文' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '章节' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '源文档' })).toBeInTheDocument();
    // 分镜入口本轮不呈现（组件保留）
    expect(screen.queryByRole('button', { name: '分镜' })).not.toBeInTheDocument();
  });

  it('switches between doc / chapters / source views', () => {
    renderLibrary({ sourceDocument: '源文档内容。' });

    fireEvent.click(screen.getByRole('button', { name: '章节' }));
    expect(screen.getByRole('button', { name: /选择第一章/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /选择第二章/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '源文档' }));
    expect(screen.getByDisplayValue('源文档内容。')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '全文' }));
    // 空文档 -> 形态 A 粘贴 CTA
    expect(screen.getByRole('button', { name: /粘贴旁白文档/ })).toBeInTheDocument();
  });

  it('remembers the last view per project in localStorage', () => {
    localStorage.setItem('nf.library.view.p1', 'chapters');
    renderLibrary({ projectId: 'p1' });
    // 记忆 chapters -> 直接落章节网格
    expect(screen.getByRole('button', { name: /选择第一章/ })).toBeInTheDocument();

    // 切换后写回
    fireEvent.click(screen.getByRole('button', { name: '源文档' }));
    expect(localStorage.getItem('nf.library.view.p1')).toBe('source');
  });

  it('falls back to doc view for unknown stored values', () => {
    localStorage.setItem('nf.library.view.p1', 'storyboard');
    renderLibrary({ projectId: 'p1', narrationScript: '正文' });
    expect(screen.getByRole('button', { name: '按标题拆分章节' })).toBeInTheDocument();
  });

  it('reports the new onModeChange contract (doc | chapters | source | chapter)', () => {
    const onModeChange = vi.fn();
    renderLibrary({ onModeChange });

    fireEvent.click(screen.getByRole('button', { name: '章节' }));
    expect(onModeChange).toHaveBeenLastCalledWith('chapters');
    fireEvent.click(screen.getByRole('button', { name: '源文档' }));
    expect(onModeChange).toHaveBeenLastCalledWith('source');
    fireEvent.click(screen.getByRole('button', { name: '全文' }));
    expect(onModeChange).toHaveBeenLastCalledWith('doc');

    // 章节沉浸编辑器
    fireEvent.click(screen.getByRole('button', { name: '章节' }));
    fireEvent.click(screen.getAllByRole('button', { name: /打开文本/ })[0]);
    expect(onModeChange).toHaveBeenLastCalledWith('chapter');
    fireEvent.click(screen.getByRole('button', { name: /返回文本库/ }));
    expect(onModeChange).toHaveBeenLastCalledWith('chapters');
  });
});

/** B2：doc 视图形态 A（空文档）：粘贴 CTA 主按钮 + 去源文档次按钮 */
describe('ProjectLibrary doc view (B2)', () => {
  it('empty doc + empty chapters: paste CTA and go-to-source secondary button', () => {
    renderLibrary({ chapters: [], narrationScript: null });

    expect(screen.getByRole('button', { name: /粘贴旁白文档/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '去源文档' }));
    // 切到 source 视图
    expect(screen.getByPlaceholderText(/源文档内容|source/i)).toBeInTheDocument();
  });

  it('generate narration doc from joined chapter text (form A fallback)', () => {
    const onUpdateNarrationScript = vi.fn();
    renderLibrary({ narrationScript: null, onUpdateNarrationScript });

    fireEvent.click(screen.getByRole('button', { name: /从现有章节生成旁白文档/ }));
    expect(onUpdateNarrationScript).toHaveBeenCalledWith('这是第一章完整旁白文本。\n\n这是第二章完整旁白文本。');
  });

  it('split button in doc view opens the chapter-split modal', async () => {
    markdownDetect.mockResolvedValue({ doc_title: '', candidates: [], chapters: [], total_chars: 0 });
    renderLibrary({ projectId: 'p1', narrationScript: '## 标题一\n\n内容一。' });

    fireEvent.click(screen.getByRole('button', { name: '按标题拆分章节' }));
    await waitFor(() =>
      expect(screen.getByRole('dialog', { name: '按标题拆分章节' })).toBeInTheDocument(),
    );
  });
});

/** B3：chapters 视图（章节网格降级入驻）：卡片管理 + 新建章节在头部；filter chips 已删 */
describe('ProjectLibrary chapters view (B3)', () => {
  it('renders chapter cards with stats and actions; decorative filter chips are gone', () => {
    renderLibrary();
    fireEvent.click(screen.getByRole('button', { name: '章节' }));

    const firstChapterSelect = screen.getByRole('button', { name: /选择第一章/ });
    expect(firstChapterSelect.closest('article')).toHaveAttribute('data-chapter-card', 'compact');
    expect(screen.getByText('3 段')).toBeInTheDocument();
    expect(screen.getByText('2/3 已生成')).toBeInTheDocument();
    expect(screen.getAllByText('进入工作室').length).toBeGreaterThan(0);
    // 装饰性 filter chips 行已删除
    expect(screen.queryByText('草稿')).not.toBeInTheDocument();
  });

  it('renames and deletes chapters from the grid without selecting them', () => {
    const onSelectChapter = vi.fn();
    const onRenameChapter = vi.fn();
    const onDeleteChapter = vi.fn();
    renderLibrary({ onSelectChapter, onRenameChapter, onDeleteChapter });
    fireEvent.click(screen.getByRole('button', { name: '章节' }));

    fireEvent.click(screen.getByRole('button', { name: /重命名章节 第一章/ }));
    fireEvent.change(screen.getByLabelText('章节标题'), { target: { value: '第一章新版' } });
    fireEvent.click(screen.getByRole('button', { name: /保存/ }));
    expect(onRenameChapter).toHaveBeenCalledWith('ch-1', '第一章新版');
    expect(onSelectChapter).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /删除章节 第二章/ }));
    expect(onDeleteChapter).toHaveBeenCalledWith('ch-2');
    expect(onSelectChapter).not.toHaveBeenCalled();
  });

  it('creates a new chapter from the chapters view header', () => {
    const onAddChapter = vi.fn();
    renderLibrary({ onAddChapter });
    fireEvent.click(screen.getByRole('button', { name: '章节' }));

    fireEvent.click(screen.getByRole('button', { name: /新建章节/ }));
    fireEvent.change(screen.getByLabelText('新章节名称'), { target: { value: '第三章：正式开场' } });
    fireEvent.click(screen.getByRole('button', { name: /创建章节/ }));
    expect(onAddChapter).toHaveBeenCalledWith('第三章：正式开场');
  });

  it('empty chapters: chapters view shows the empty state with new-chapter entry', () => {
    const onAddChapter = vi.fn();
    renderLibrary({ chapters: [], onAddChapter });
    fireEvent.click(screen.getByRole('button', { name: '章节' }));

    expect(screen.getByText(/还没有章节/)).toBeInTheDocument();
    // 头部与空态各有一个新建章节入口，均可达
    expect(screen.getAllByRole('button', { name: /新建章节/ }).length).toBeGreaterThanOrEqual(2);
    fireEvent.click(screen.getAllByRole('button', { name: /新建章节/ })[1]);
    expect(onAddChapter).toHaveBeenCalled();
  });
});

/** B1：章节沉浸编辑器原样保留 */
describe('ProjectLibrary chapter editor (B1)', () => {
  it('opens the immersive chapter editor from a card and goes back to chapters view', () => {
    const onSelectChapter = vi.fn();
    renderLibrary({ onSelectChapter });
    fireEvent.click(screen.getByRole('button', { name: '章节' }));

    fireEvent.click(screen.getAllByRole('button', { name: /打开文本/ })[0]);
    expect(onSelectChapter).toHaveBeenCalledWith('ch-1');
    expect(screen.getByText('Immersive Chapter Editor')).toBeInTheDocument();
    expect(screen.getByLabelText('章节标题')).toHaveValue('第一章');
    expect(screen.getByLabelText('章节全文')).toHaveValue('这是第一章完整旁白文本。');

    fireEvent.click(screen.getByRole('button', { name: /返回文本库/ }));
    expect(screen.getByRole('button', { name: /选择第一章/ })).toBeInTheDocument();
  });

  it('edits chapter title, design title, and text inside the editor', () => {
    const onRenameChapter = vi.fn();
    const onUpdateChapterText = vi.fn();
    const onUpdateChapterDesignTitle = vi.fn();
    renderLibrary({ onRenameChapter, onUpdateChapterText, onUpdateChapterDesignTitle });
    fireEvent.click(screen.getByRole('button', { name: '章节' }));

    fireEvent.click(screen.getAllByRole('button', { name: /打开文本/ })[0]);
    fireEvent.change(screen.getByLabelText('章节标题'), { target: { value: '新标题' } });
    fireEvent.change(screen.getByLabelText('设计标题'), { target: { value: '新设计标题' } });
    fireEvent.change(screen.getByLabelText('章节全文'), { target: { value: '新的完整旁白文本' } });

    expect(onRenameChapter).toHaveBeenCalledWith('ch-1', '新标题');
    expect(onUpdateChapterDesignTitle).toHaveBeenCalledWith('ch-1', '新设计标题');
    expect(onUpdateChapterText).toHaveBeenCalledWith('ch-1', '新的完整旁白文本');
  });

  it('enters Studio from grid and editor', () => {
    const onEnterStudio = vi.fn();
    renderLibrary({ onEnterStudio });
    fireEvent.click(screen.getByRole('button', { name: '章节' }));

    fireEvent.click(screen.getAllByRole('button', { name: /进入工作室/ })[0]);
    expect(onEnterStudio).toHaveBeenCalledWith('ch-1');

    fireEvent.click(screen.getAllByRole('button', { name: /打开文本/ })[0]);
    fireEvent.click(screen.getByRole('button', { name: /进入工作室/ }));
    expect(onEnterStudio).toHaveBeenCalledWith('ch-1');
  });
});

/** B5：拆分应用后留在 doc 视图，结果反馈附「查看章节」跳转 */
describe('ProjectLibrary split result feedback (B5)', () => {
  const DETECT = {
    doc_title: '文档标题',
    candidates: [
      { index: 0, title: '第一章', level: 2, start_char: 8, end_char: 21, char_count: 13, preview: '内容一。' },
    ],
    chapters: [],
    total_chars: 33,
  };
  const SPLIT = { ...DETECT, chapters: DETECT.candidates, used_levels: [2] };
  const REUSE = {
    chapters_matched: 1,
    segments_matched: 2,
    segments_reused: 2,
    segments_new: 1,
    per_chapter: [],
    discard: { text_changed: 1, boundary_changed: 0, no_audio: 0 },
    recorded_discard: 0,
  };
  const FULL_TEXT = '# 文档标题\n\n## 第一章\n内容一。\n';

  async function applySplit() {
    markdownDetect.mockResolvedValue(DETECT);
    markdownSplit.mockResolvedValue(SPLIT);
    batchCreateChapters.mockResolvedValue({ chapters: [], reuse: REUSE });
    renderLibrary({ projectId: 'p1', narrationScript: FULL_TEXT });

    fireEvent.click(screen.getByRole('button', { name: '按标题拆分章节' }));
    const modal = await screen.findByRole('dialog', { name: '按标题拆分章节' });
    fireEvent.click(screen.getByText('预览拆分'));
    await screen.findByText('01. 第一章');
    fireEvent.click(screen.getByText('应用到项目'));
    fireEvent.click(await screen.findByRole('button', { name: '确认替换' }));
    await waitFor(() => expect(modal).not.toBeInTheDocument());
  }

  it('stays in doc view after apply and shows the honest result dialog', async () => {
    await applySplit();
    const dialog = await screen.findByRole('alertdialog', { name: '拆分完成' });
    expect(dialog).toHaveTextContent('拆分完成：保留 2 段已合成音频，新增 1 段');
    expect(dialog).toHaveTextContent('丢弃 1 段：文本变化 1 / 拆分边界变化 0。');
    // 留在文档：仍处 doc 视图（拆分按钮在 doc 视图头部）
    fireEvent.click(screen.getByRole('button', { name: '留在文档' }));
    expect(screen.getByRole('button', { name: '按标题拆分章节' })).toBeInTheDocument();
  });

  it('view-chapters button jumps to the chapters view', async () => {
    await applySplit();
    await screen.findByRole('alertdialog', { name: '拆分完成' });
    fireEvent.click(screen.getByRole('button', { name: '查看章节' }));
    expect(screen.getByRole('button', { name: /选择第一章/ })).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});
