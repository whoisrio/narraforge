/** Supported workflow kinds and their LangGraph bindings. */
export type WorkflowKind = 'narration' | 'knowledge_video';

export const WORKFLOW_KINDS: Record<
  WorkflowKind,
  { kind: string; assistantId: string; label: string }
> = {
  narration: {
    kind: 'narration_workflow',
    assistantId: 'narration',
    label: '旁白工作流',
  },
  knowledge_video: {
    kind: 'knowledge_video_workflow',
    assistantId: 'knowledge_video',
    label: '知识视频工作流',
  },
};

/** Node name -> state keys populated when the node completes. */
export const NODE_STATE_KEYS: Record<string, string[]> = {
  // narration
  gen_script: ['narration_script'],
  script_review: ['review_feedback'],
  select_tts_engine: ['tts_engine'],
  split_segment: ['structured_segments'],
  synthesis: ['synthesis_results'],
  // knowledge_video
  preflight_check: ['source_document'],
  gen_narration: ['narration_script'],
  quality_review: ['review_result'],
  review_decision: ['review_status'],
  split_chapters: ['structured_segments'],
  scaffold_remotion: ['remotion_project_dir'],
};

/** Input fields the frontend renders when starting a run. */
export const INPUT_FIELDS: Record<string, Record<string, string>> = {
  narration: { project_id: 'Project' },
  knowledge_video: { project_id: 'Project' },
};
