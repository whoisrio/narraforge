import { describe, expect, it } from 'vitest';
import { NODE_STATE_KEYS, WORKFLOW_KINDS } from './contracts';

describe('WORKFLOW_KINDS', () => {
  it('maps narration kind', () => {
    expect(WORKFLOW_KINDS.narration).toEqual({
      kind: 'narration_workflow',
      assistantId: 'narration',
      label: '旁白工作流',
    });
  });

  it('maps knowledge_video kind', () => {
    expect(WORKFLOW_KINDS.knowledge_video).toEqual({
      kind: 'knowledge_video_workflow',
      assistantId: 'knowledge_video',
      label: '知识视频工作流',
    });
  });
});

describe('NODE_STATE_KEYS', () => {
  it('keeps narration node keys', () => {
    expect(NODE_STATE_KEYS.gen_script).toEqual(['narration_script']);
    expect(NODE_STATE_KEYS.synthesis).toEqual(['synthesis_results']);
  });

  it('adds kv node keys', () => {
    expect(NODE_STATE_KEYS.preflight_check).toEqual(['source_document']);
    expect(NODE_STATE_KEYS.gen_narration).toEqual(['narration_script']);
    expect(NODE_STATE_KEYS.quality_review).toEqual(['review_result']);
    expect(NODE_STATE_KEYS.split_chapters).toEqual(['structured_segments']);
    expect(NODE_STATE_KEYS.scaffold_remotion).toEqual(['remotion_project_dir']);
    expect(NODE_STATE_KEYS.gen_animation_brief).toEqual(['animation_brief']);
  });
});
