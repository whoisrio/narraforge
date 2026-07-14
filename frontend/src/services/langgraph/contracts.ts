/** Node name -> state keys populated when the node completes. */
export const NODE_STATE_KEYS: Record<string, string[]> = {
  gen_script: ['narration_script'],
  script_review: ['review_feedback'],
  split_segment: ['structured_segments'],
  synthesis: ['synthesis_results'],
};

/** Input fields the frontend renders when starting a run. */
export const INPUT_FIELDS: Record<string, Record<string, string>> = {
  narration: { project_id: 'Project' },
};