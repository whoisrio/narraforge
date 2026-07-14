import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { PipelineTimeline } from './PipelineTimeline';

const nodes = [
  { id: 'gen_script', name: 'gen_script' },
  { id: 'script_review', name: 'script_review' },
  { id: 'split_segment', name: 'split_segment' },
  { id: 'synthesis', name: 'synthesis' },
];

describe('PipelineTimeline', () => {
  it('marks gen_script completed and script_review running', () => {
    render(
      <PipelineTimeline
        nodes={nodes}
        values={{ narration_script: 'x' }}
        currentStage="script_review"
      />,
    );
    expect(screen.getByText('gen_script').closest('[data-status]')?.getAttribute('data-status')).toBe('completed');
    expect(screen.getByText('script_review').closest('[data-status]')?.getAttribute('data-status')).toBe('running');
    expect(screen.getByText('synthesis').closest('[data-status]')?.getAttribute('data-status')).toBe('pending');
  });
});