import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const submitMock = vi.fn();
const streamMock = {
  values: {},
  isLoading: false,
  interrupts: [
    {
      value: {
        kind: 'confirm_overwrite',
        stats: { chapters: 1, segments: 2, synthesized_segments: 0, has_animation_brief: false },
        available_actions: ['confirm', 'cancel'],
      },
    },
  ],
  submit: submitMock,
};

vi.mock('@langchain/langgraph-sdk/react', () => ({
  useStream: () => streamMock,
}));

vi.mock('../../services/langgraph/client', () => ({
  agentClient: {
    assistants: { getGraph: vi.fn().mockResolvedValue({ nodes: [] }) },
  },
}));

import { WorkflowDrawer } from './WorkflowDrawer';

describe('WorkflowDrawer interrupt resume', () => {
  beforeEach(() => {
    submitMock.mockClear();
  });

  it('resumes a confirm_overwrite interrupt via submit(command.resume)', () => {
    render(
      <WorkflowDrawer
        threadId="t1"
        projectId="p1"
        assistantId="knowledge_video"
        onClose={() => {}}
        onCollapse={() => {}}
      />,
    );

    fireEvent.click(screen.getByText('确认重建'));

    const resumeCalls = submitMock.mock.calls.filter(
      (args) => args[1]?.command?.resume !== undefined,
    );
    expect(resumeCalls).toHaveLength(1);
    expect(resumeCalls[0][0]).toBeNull();
    expect(resumeCalls[0][1].command.resume).toEqual({ action: 'confirm' });
  });
});
