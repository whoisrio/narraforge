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
  review_retry_count?: number;
  error?: string | null;
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
  data: Record<string, unknown>;
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

export interface VisualContent {
  type: 'code' | 'image' | 'key_points' | 'text';
  description: string;
  source_ref: string | null;
}

export interface SegmentBrief {
  segment_position: number;
  narration_text: string;
  start_sec?: number;
  end_sec?: number;
  visual_content: VisualContent;
  animation: { effect: string; notes: string };
}

export interface ChapterBrief {
  chapter_position: number;
  title: string;
  segments: SegmentBrief[];
}

export interface AnimationBrief {
  chapters: ChapterBrief[];
}

export interface KnowledgeVideoState {
  target_dir?: string | null;
  source_structure_map?: Array<Record<string, unknown>>;
  review_result?: QualityReviewResult;
  remotion_project_dir?: string;
  animation_brief?: AnimationBrief;
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
    has_animation_brief: boolean;
  };
  available_actions: string[];
}