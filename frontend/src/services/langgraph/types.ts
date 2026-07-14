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