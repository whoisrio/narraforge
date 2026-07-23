/** TS mirror of agent/app/schemas.py + NarrationWorkflowState. */

export type ReviewStatus = 'pass' | 'warn' | 'fail';

export interface ReviewDimension {
  name: string;
  status: ReviewStatus;
  comment: string;
  suggestion: string | null;
}

export interface ReviewResult {
  dimensions: ReviewDimension[];
  overall_score: number;
  overall_comment: string;
  has_critical_issue: boolean;
}

export interface Segment {
  text: string;
  emotion: string;
  role: string;
  segment_kind: string;
  _segment_id?: string;
}

export interface ChapterStructure {
  chapter_title: string;
  segments: Segment[];
  _chapter_id?: string;
}

export interface SynthResult {
  chapter_id: string;
  segment_id: string;
  audio_path: string | null;
  duration_sec: number | null;
}

export interface NarraWorkflowState {
  project_id?: string;
  source_document?: string;
  narration_script?: string;
  script_chapters?: ChapterStructure[];
  review_feedback?: ReviewResult;
  edited_script?: string;
  review_status?: 'approved' | 'rejected';
  structured_segments?: ChapterStructure[];
  synthesis_results?: SynthResult[];
  current_stage?: string;
  /** select_tts_engine interrupt 确认后写入的合成引擎。 */
  tts_engine?: string;
  review_retry_count?: number;
  error?: string | null;
  /** 各节点 LLM token 用量（落 state，接管已完成线程也可读）。 */
  stage_usage?: Record<string, TokenUsage>;
}

/** LLM token usage, mirroring LangChain `usage_metadata`. */
export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens?: number;
  /** Thinking-mode providers (Qwen) report reasoning consumption separately. */
  reasoning_tokens?: number;
}

export type MilestoneType =
  | 'stage_start'
  | 'llm_call'
  | 'llm_streaming'
  | 'llm_response'
  | 'auto_reject'
  | 'interrupt'
  | 'progress'
  | 'stage_complete'
  | 'error';

export interface MilestoneEvent {
  type: MilestoneType;
  stage: string;
  message: string;
  /** Arbitrary payload; LLM 节点的 stage_complete 事件带 usage 汇总。 */
  data: Record<string, unknown> & { usage?: TokenUsage };
}

/** TS mirror of agent/app/schemas.py kv additions + KnowledgeVideoState. */

export interface QualityDimension {
  name: string;
  passed: boolean;
  comment: string;
}

export interface QualityReviewResult {
  passed: boolean;
  dimensions: QualityDimension[];
  issues: string[];
}

export interface KnowledgeVideoState {
  target_dir?: string | null;
  source_structure_map?: Array<Record<string, unknown>>;
  review_result?: QualityReviewResult;
  remotion_project_dir?: string;
}

/** Drawer state: narration fields + kv additions (overlapping keys are compatible). */
export type WorkflowState = NarraWorkflowState & KnowledgeVideoState;

/** Preflight overwrite-confirm interrupt payload. */
export interface ConfirmOverwriteInterrupt {
  kind: 'confirm_overwrite';
  stats: {
    chapters: number;
    segments: number;
    synthesized_segments: number;
  };
  available_actions: string[];
}

/** TTS 引擎询问 interrupt 载荷；resume 提交 { engine: string }。 */
export interface SelectEngineInterrupt {
  kind: 'select_tts_engine';
  available_engines: string[];
  default_engine: string;
  timeout_s: number;
}