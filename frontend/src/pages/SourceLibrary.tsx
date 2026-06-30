import { useState, useMemo } from 'react';
import type { SegmentedProject, SourceDocument, NarrationDocument } from '../types';
import { textAnalysisApi, type TextAnalysisSplitResult } from '../services/api';
import { GenerateNarrationModal } from '../components/SourceLibrary/GenerateNarrationModal';
import { SourceUploadZone } from '../components/SourceLibrary/SourceUploadZone';
import { NarrationFullView } from '../components/SourceLibrary/NarrationFullView';
import { ScriptAnalysisModal } from '../components/SourceLibrary/ScriptAnalysisModal';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import styles from './SourceLibrary.module.css';

interface ToastItem {
  id: number;
  message: string;
  type: 'success' | 'error';
}
let toastIdCounter = 0;
// Module-level ref-style singleton for toast (works across this single page)
const toastListeners: ((items: ToastItem[]) => void)[] = [];
let toastItems: ToastItem[] = [];
function emitToast() {
  toastListeners.forEach(fn => fn(toastItems));
}
function showToast(message: string, type: 'success' | 'error' = 'success') {
  const id = ++toastIdCounter;
  toastItems = [...toastItems, { id, message, type }];
  emitToast();
  setTimeout(() => {
    toastItems = toastItems.filter(t => t.id !== id);
    emitToast();
  }, 2500);
}

// Mock projects (后续接 API) — 模拟 3 个项目
const MOCK_PROJECTS: SegmentedProject[] = [
  { schema_version: 2, id: '__scratchpad__', name: '📌 草稿台', chapters: [], layout: 'vertical', active_narration_version: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() } as SegmentedProject,
  { schema_version: 2, id: 'p-deepseek', name: 'DeepSeek 战略拆解', chapters: [], layout: 'vertical', active_narration_version: 'v2', created_at: new Date().toISOString(), updated_at: new Date().toISOString() } as SegmentedProject,
  { schema_version: 2, id: 'p-ymtc', name: 'YMTC 长江存储科普', chapters: [], layout: 'vertical', active_narration_version: 'v1', created_at: new Date().toISOString(), updated_at: new Date().toISOString() } as SegmentedProject,
  { schema_version: 2, id: 'p-moe', name: 'MoE 架构讲解', chapters: [], layout: 'vertical', active_narration_version: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() } as SegmentedProject,
];

// Mock sources (按 project_id 索引)
const MOCK_SOURCES: Record<string, SourceDocument[]> = {
  'p-deepseek': [
    { id: 's-ds-1', project_id: 'p-deepseek', source_type: 'paste', title: 'DeepSeek 战略笔记.md', pasted_text: '2026 年开年，DeepSeek 以极致成本训练出 R1 模型…', file_size: 1024, created_at: '2026-06-11T10:15:00Z' },
    { id: 's-ds-2', project_id: 'p-deepseek', source_type: 'audio', title: 'CEO 访谈录音.mp3', audio_path: '/uploads/ds-ceo.mp3', duration_sec: 272, file_size: 4096000, created_at: '2026-06-11T10:20:00Z' },
  ],
  'p-ymtc': [
    { id: 's-ym-1', project_id: 'p-ymtc', source_type: 'paste', title: 'YMTC 论文摘要.md', pasted_text: '长江存储在 3D NAND 领域…', file_size: 2048, created_at: '2026-06-10T14:30:00Z' },
  ],
  'p-moe': [],
  '__scratchpad__': [],
};

// Mock narration history (按 project_id 索引, 含多个版本)
const MOCK_NARRATIONS: Record<string, NarrationDocument[]> = {
  'p-deepseek': [
    {
      id: 'n-ds-v1', project_id: 'p-deepseek', version: 'v1', version_kind: 'full',
      body_markdown: '## 第 1 章 · 背景\n\n2026 年开年，AI 竞争激烈...\n\n## 第 2 章 · 战略\n\n低成本是核心...',
      word_count: 980, source_ids: ['s-ds-1'],
      prompt_hint: null, settings: { target_chapters: 2, engine: 'mimo' },
      chapter_slices: [
        { chapter_index: 0, title: '第 1 章 · 背景', start_char: 0, end_char: 480 },
        { chapter_index: 1, title: '第 2 章 · 战略', start_char: 480, end_char: 980 },
      ],
      generated_at: '2026-06-11T09:30:00Z',
    },
    {
      id: 'n-ds-v2', project_id: 'p-deepseek', version: 'v2', version_kind: 'full',
      body_markdown: '## 第 1 章 · 战略起源\n\n2026 年开年，AI 产业进入深水区。DeepSeek 以极致成本训练出 R1 模型，把整个行业的护城河重新画了一遍。\n\n但真正的护城河，从来不是模型本身，而是算力供应链。\n\n本章我们拆解 DeepSeek 战略背后的三个支点：第一是 MLA 多头潜在注意力机制，砍掉 KV 缓存 90% 占用；第二是 DualPath 双路径架构；第三是 MoE 混合专家的精修路线。\n\n## 第 2 章 · 技术路线\n\n先说 MLA。传统 Transformer 的 KV 缓存会随着序列长度线性增长，导致长文本推理时显存爆炸。MLA 用低秩投影把 KV 压缩到一个潜在空间，缓存体积骤降。\n\n再说 DualPath。DeepSeek 创新性地把训练和推理拆成两条路径：训练时用稠密参数保证质量，推理时用稀疏激活保证速度。\n\n最后是 MoE。256 个专家，每次只激活 8 个，靠路由机制决定 token 去哪。\n\n## 第 3 章 · 产业映射\n\n技术再强，最终要落到产业。对标 Nvidia 是昇腾，对标 TSMC 是中芯国际，对标 ASML 是新凯来，对标 Samsung 是长江存储。\n\n这条国产替代链路的逻辑不是错位竞争，而是在政企信创市场里做出完全够用、价格又比海外品牌低 30% 的产品。',
      word_count: 1247, source_ids: ['s-ds-1', 's-ds-2'],
      prompt_hint: '语气保持冷静专业，少用数字罗列，多用对比和反问。',
      settings: { target_chapters: 3, engine: 'mimo' },
      chapter_slices: [
        { chapter_index: 0, title: '第 1 章 · 战略起源', start_char: 0, end_char: 380 },
        { chapter_index: 1, title: '第 2 章 · 技术路线', start_char: 380, end_char: 820 },
        { chapter_index: 2, title: '第 3 章 · 产业映射', start_char: 820, end_char: 1247 },
      ],
      generated_at: '2026-06-11T10:23:00Z',
    },
  ],
  'p-ymtc': [
    {
      id: 'n-ym-v1', project_id: 'p-ymtc', version: 'v1', version_kind: 'full',
      body_markdown: '## 长江存储科普\n\n长江存储（YMTC）是中国自主 3D NAND 闪存制造商...',
      word_count: 540, source_ids: ['s-ym-1'],
      prompt_hint: null, settings: { target_chapters: 1, engine: 'mimo' },
      chapter_slices: [{ chapter_index: 0, title: '长江存储科普', start_char: 0, end_char: 540 }],
      generated_at: '2026-06-10T15:00:00Z',
    },
  ],
  'p-moe': [],
  '__scratchpad__': [],
};

export function SourceLibrary() {
  const [activeProjectId, setActiveProjectId] = useState<string>('p-deepseek');
  const [sourcesByProject, setSourcesByProject] = useState<Record<string, SourceDocument[]>>(MOCK_SOURCES);
  const [narrationsByProject, setNarrationsByProject] = useState<Record<string, NarrationDocument[]>>(MOCK_NARRATIONS);
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [fullView, setFullView] = useState<NarrationDocument | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ sourceId: string; title: string } | null>(null);
  const [activeVersion, setActiveVersion] = useState<Record<string, string>>({ 'p-deepseek': 'v2', 'p-ymtc': 'v1' });

  // Script analysis state
  const [analyzingSourceId, setAnalyzingSourceId] = useState<string | null>(null);
  const [analysisResult, setAnalysisResult] = useState<TextAnalysisSplitResult | null>(null);
  const [, setAnalysisSourceTitle] = useState('');

  const activeProject = useMemo(
    () => MOCK_PROJECTS.find(p => p.id === activeProjectId) || MOCK_PROJECTS[0],
    [activeProjectId]
  );
  const activeSources = sourcesByProject[activeProjectId] || [];
  const activeNarrations = narrationsByProject[activeProjectId] || [];
  const currentVersion = activeVersion[activeProjectId] || activeProject.active_narration_version;
  const currentNarration = activeNarrations.find(n => n.version === currentVersion) || null;

  const isScratchpad = activeProjectId === '__scratchpad__';

  const handleAddSources = (newSources: SourceDocument[]) => {
    setSourcesByProject(prev => ({
      ...prev,
      [activeProjectId]: [...(prev[activeProjectId] || []), ...newSources],
    }));
    showToast(`已添加 ${newSources.length} 个源`, 'success');
  };

  const handleDeleteSource = (sourceId: string) => {
    const src = (sourcesByProject[activeProjectId] || []).find(s => s.id === sourceId);
    if (!src) return;
    setConfirmDelete({ sourceId, title: src.title });
  };

  const confirmDeleteAction = () => {
    if (!confirmDelete) return;
    setSourcesByProject(prev => ({
      ...prev,
      [activeProjectId]: (prev[activeProjectId] || []).filter(s => s.id !== confirmDelete.sourceId),
    }));
    showToast(`已删除源: ${confirmDelete.title}`, 'success');
    setConfirmDelete(null);
  };

  const handleGenerate = (sourceIds: string[], promptHint: string) => {
    // 模拟生成旁白 (后续接 API)
    setShowGenerateModal(false);
    showToast('🚧 LLM 旁白生成待 P2.4 端点', 'success');
    // demo: 直接生成 v3 mock
    const newVersion = nextVersion(activeNarrations.map(n => n.version));
    const newNarr: NarrationDocument = {
      id: `n-${activeProjectId}-${newVersion}`,
      project_id: activeProjectId,
      version: newVersion,
      version_kind: 'full',
      body_markdown: '## 第 1 章 · 演示\n\n这是 mock 生成的旁白...\n\n## 第 2 章 · 继续\n\n更多内容...',
      word_count: 800,
      source_ids: sourceIds,
      prompt_hint: promptHint || null,
      settings: { target_chapters: 2, engine: 'mimo' },
      chapter_slices: [
        { chapter_index: 0, title: '第 1 章 · 演示', start_char: 0, end_char: 400 },
        { chapter_index: 1, title: '第 2 章 · 继续', start_char: 400, end_char: 800 },
      ],
      generated_at: new Date().toISOString(),
    };
    setNarrationsByProject(prev => ({
      ...prev,
      [activeProjectId]: [newNarr, ...(prev[activeProjectId] || [])],
    }));
    setActiveVersion(prev => ({ ...prev, [activeProjectId]: newVersion }));
  };

  const handleSwitchVersion = (version: string) => {
    setActiveVersion(prev => ({ ...prev, [activeProjectId]: version }));
    showToast(`已切换到 ${version}`, 'success');
  };

  const handleCreateProject = () => {
    const id = `p-new-${Date.now()}`;
    const name = `新项目 ${MOCK_PROJECTS.filter(p => p.id !== '__scratchpad__').length}`;
    const newProj: SegmentedProject = {
      schema_version: 2, id, name, chapters: [], layout: 'vertical',
      active_narration_version: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    } as SegmentedProject;
    MOCK_PROJECTS.push(newProj);
    setActiveProjectId(id);
    showToast(`已创建项目: ${name}`, 'success');
  };

  const handleAnalyzeSource = async (source: SourceDocument) => {
    if (!source.pasted_text) return;
    setAnalyzingSourceId(source.id);
    setAnalysisResult(null);

    try {
      const result = await textAnalysisApi.splitScript(source.pasted_text, 'auto');
      setAnalysisResult(result);
    } catch {
      setAnalysisResult(null);
    } finally {
      setAnalyzingSourceId(null);
    }
  };

  const handleCloseAnalysis = () => {
    setAnalysisResult(null);
    setAnalysisSourceTitle('');
  };

  return (
    <div className={styles.container}>
      <div className={styles.layout}>
        {/* 左: 项目侧栏 */}
        <aside className={styles.sidebar}>
          <div className={styles.sidebarHeader}>
            <span className={styles.eyebrow}>Project</span>
            <h2 className={styles.sidebarTitle}>项目</h2>
          </div>
          <button className={styles.newProjectBtn} onClick={handleCreateProject}>
            <span>+</span> 新建项目
          </button>
          <div className={styles.projectList}>
            {MOCK_PROJECTS.map(project => {
              const isActive = project.id === activeProjectId;
              const sourceCount = (sourcesByProject[project.id] || []).length;
              const narrCount = (narrationsByProject[project.id] || []).length;
              return (
                <button
                  key={project.id}
                  className={`${styles.projectItem} ${isActive ? styles.projectItemActive : ''}`}
                  onClick={() => setActiveProjectId(project.id)}
                >
                  <span className={styles.projectIcon}>{project.id === '__scratchpad__' ? '草' : project.name.charAt(0)}</span>
                  <div className={styles.projectBody}>
                    <div className={styles.projectName}>
                      {project.name}
                      {project.id === '__scratchpad__' && <span className={styles.pinBadge}>默认</span>}
                    </div>
                    <div className={styles.projectMeta}>
                      {sourceCount} 源 · {narrCount} 旁白 · {project.active_narration_version || '—'}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        {/* 右: 工作区 */}
        <main className={styles.main}>
          <div className={styles.mainHeader}>
            <div className={styles.titleCluster}>
              <span className={styles.eyebrow}>Source Library</span>
              <h1 className={styles.mainTitle}>{activeProject.name} · 素材库</h1>
            </div>
            {!isScratchpad && (
              <div className={styles.headerActions}>
                <button
                  className={styles.primaryBtn}
                  onClick={() => setShowGenerateModal(true)}
                  disabled={activeSources.length === 0}
                  title={activeSources.length === 0 ? '请先添加源' : '基于选中源生成旁白文档'}
                >
                  🧠 生成旁白文档
                </button>
              </div>
            )}
          </div>

          {isScratchpad ? (
            <div className={styles.scratchpadNotice}>
              <span className={styles.noticeIcon}>📌</span>
              <div>
                <div className={styles.noticeTitle}>草稿台不支持素材管理</div>
                <div className={styles.noticeDesc}>草稿台是临时试稿区，请新建或选择一个正式项目来管理素材。</div>
              </div>
            </div>
          ) : (
            <div className={styles.workspace}>
              {/* 1. 源 */}
              <section className={styles.section}>
                <div className={styles.sectionHeader}>
                  <h2 className={styles.sectionTitle}>📚 源 · {activeSources.length}</h2>
                  <span className={styles.sectionHint}>
                    文本/音频原始素材 · LLM 输入池
                  </span>
                </div>
                {activeSources.length > 0 ? (
                  <div className={styles.sourceGrid}>
                    {activeSources.map(src => (
                      <div key={src.id} className={styles.sourceCard}>
                        <div className={styles.sourceCardHeader}>
                          <span className={styles.sourceCardIcon}>
                            {src.source_type === 'paste' ? '📄' : src.source_type === 'audio' ? '🎵' : '🔗'}
                          </span>
                          <div className={styles.sourceCardBody}>
                            <div className={styles.sourceCardTitle}>{src.title}</div>
                            <div className={styles.sourceCardMeta}>
                              {src.source_type === 'paste' && src.pasted_text && `${src.pasted_text.length} 字`}
                              {src.source_type === 'audio' && src.duration_sec && formatDuration(src.duration_sec)}
                              {src.source_type === 'path' && '本地路径引用'}
                              {' · 添加于 '}
                              {new Date(src.created_at).toLocaleDateString('zh-CN')}
                            </div>
                          </div>
                          <button
                            className={styles.deleteBtn}
                            onClick={() => handleDeleteSource(src.id)}
                            title="删除源"
                          >
                            ×
                          </button>
                        </div>
                        {src.source_type === 'paste' && src.pasted_text && (
                          <>
                            <div className={styles.sourcePreview}>
                              {src.pasted_text.slice(0, 100)}
                              {src.pasted_text.length > 100 ? '...' : ''}
                            </div>
                            <div className={styles.sourceActions}>
                              <button
                                className={styles.splitBtn}
                                onClick={() => handleAnalyzeSource(src)}
                                disabled={analyzingSourceId === src.id}
                              >
                                {analyzingSourceId === src.id ? '分析中...' : '🔍 智能拆分章节'}
                              </button>
                            </div>
                          </>
                        )}
                        {src.source_type === 'audio' && (
                          <div className={styles.sourceAudioRow}>
                            <button className={styles.audioPlayBtn} disabled>▶ 试听</button>
                            <span className={styles.audioStatus}>已上传</span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className={styles.emptyState}>
                    <div className={styles.emptyIcon}>📚</div>
                    <div className={styles.emptyTitle}>还没有任何源</div>
                    <div className={styles.emptyDesc}>添加文本或音频素材，LLM 会基于它们合成口播稿</div>
                  </div>
                )}
                <SourceUploadZone
                  onAdd={handleAddSources}
                  projectId={activeProjectId}
                />
              </section>

              {/* 2. 旁白文档 */}
              <section className={styles.section}>
                <div className={styles.sectionHeader}>
                  <h2 className={styles.sectionTitle}>
                    📜 旁白文档
                    {activeNarrations.length > 0 && (
                      <span className={styles.versionBadge}>v{currentVersion}</span>
                    )}
                  </h2>
                  <span className={styles.sectionHint}>
                    切换版本可对比 · 上限 10 个版本
                  </span>
                </div>
                {activeNarrations.length > 0 ? (
                  <>
                    {/* 当前活跃版本 - 始终展示 */}
                    {currentNarration && (
                      <div className={`${styles.narrationCard} ${styles.narrationCardActive}`}>
                        <div className={styles.narrationCardHeader}>
                          <div className={styles.narrationVersionBlock}>
                            <span className={styles.narrationVersion}>{currentNarration.version}</span>
                            <span className={styles.narrationKind}>
                              {currentNarration.version_kind === 'full' ? '整稿' : '章节 fork'}
                            </span>
                            <span className={styles.narrationActiveTag}>活跃</span>
                          </div>
                          <div className={styles.narrationMeta}>
                            {(currentNarration.chapter_slices || []).length} 章节 · {currentNarration.word_count.toLocaleString()} 字
                          </div>
                          <div className={styles.narrationActions}>
                            <button
                              className={styles.actionBtn}
                              onClick={() => setFullView(currentNarration)}
                            >
                              👁 全文
                            </button>
                            <button
                              className={styles.actionBtn}
                              onClick={() => {
                                navigator.clipboard.writeText(currentNarration.body_markdown);
                                showToast('已复制 markdown', 'success');
                              }}
                            >
                              📋 复制
                            </button>
                          </div>
                        </div>
                        <div className={styles.narrationPreview}>
                          {currentNarration.body_markdown.slice(0, 200).replace(/^#+\s.*$/gm, '').trim() || '(空文档)'}
                          {currentNarration.body_markdown.length > 200 ? '...' : ''}
                        </div>
                        <div className={styles.narrationFooter}>
                          <span>基于 {currentNarration.source_ids.length} 个源</span>
                          {currentNarration.prompt_hint && (
                            <span className={styles.promptHint}>提示: "{currentNarration.prompt_hint}"</span>
                          )}
                          <span className={styles.generatedAt}>
                            {new Date(currentNarration.generated_at).toLocaleString('zh-CN', { hour12: false })}
                          </span>
                        </div>
                      </div>
                    )}

                    {/* 历史版本 - 默认折叠 (仅当 >1 个版本时显示) */}
                    {activeNarrations.length > 1 && (
                      <details className={styles.historyBlock}>
                        <summary className={styles.historySummary}>
                          📚 历史版本 ({activeNarrations.length - 1} 个)
                          <span className={styles.historyHint}>点击展开</span>
                        </summary>
                        <div className={styles.historyList}>
                          {activeNarrations
                            .filter(n => n.version !== currentVersion)
                            .sort((a, b) => b.generated_at.localeCompare(a.generated_at))
                            .map(narr => (
                              <div key={narr.id} className={styles.historyItem}>
                                <div className={styles.historyItemLeft}>
                                  <span className={styles.historyVersion}>{narr.version}</span>
                                  <span className={styles.historyKind}>
                                    {narr.version_kind === 'full' ? '整稿' : '章节 fork'}
                                  </span>
                                  <span className={styles.historyMeta}>
                                    {(narr.chapter_slices || []).length} 章节 · {narr.word_count.toLocaleString()} 字
                                  </span>
                                  <span className={styles.historyDate}>
                                    {new Date(narr.generated_at).toLocaleString('zh-CN', { hour12: false })}
                                  </span>
                                </div>
                                <div className={styles.historyItemActions}>
                                  <button
                                    className={styles.actionBtn}
                                    onClick={() => setFullView(narr)}
                                  >
                                    👁
                                  </button>
                                  <button
                                    className={styles.actionBtn}
                                    onClick={() => handleSwitchVersion(narr.version)}
                                  >
                                    切为此版
                                  </button>
                                </div>
                              </div>
                            ))}
                        </div>
                      </details>
                    )}
                  </>
                ) : (
                  <div className={styles.emptyState}>
                    <div className={styles.emptyIcon}>📜</div>
                    <div className={styles.emptyTitle}>还没有旁白文档</div>
                    <div className={styles.emptyDesc}>
                      {activeSources.length === 0
                        ? '先在上方添加源，再点 "生成旁白文档"'
                        : '点右上角 "生成旁白文档" 开始'}
                    </div>
                  </div>
                )}
              </section>
            </div>
          )}
        </main>
      </div>

      {showGenerateModal && (
        <GenerateNarrationModal
          sources={activeSources}
          onClose={() => setShowGenerateModal(false)}
          onGenerate={handleGenerate}
        />
      )}

      {fullView && (
        <NarrationFullView
          narration={fullView}
          onClose={() => setFullView(null)}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          open
          title="删除源"
          message={`确定删除「${confirmDelete.title}」？\n若已有旁白文档基于此源生成，需要重新生成。`}
          variant="warning"
          confirmLabel="删除"
          onConfirm={confirmDeleteAction}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      {(analysisResult !== null || analyzingSourceId !== null) && (
        <ScriptAnalysisModal
          result={analysisResult}
          loading={analyzingSourceId !== null}
          onClose={handleCloseAnalysis}
          onConfirm={() => {
            showToast('章节和角色已识别，后续可在 Studio 中使用', 'success');
            handleCloseAnalysis();
          }}
        />
      )}
    </div>
  );
}

function nextVersion(existing: string[]): string {
  // 简化: 找现有最大 major+1
  const majors = existing
    .map(v => parseInt(v.replace(/^v/, '').split('.')[0], 10))
    .filter(n => !isNaN(n));
  const next = (Math.max(0, ...majors) + 1);
  return `v${next}`;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
