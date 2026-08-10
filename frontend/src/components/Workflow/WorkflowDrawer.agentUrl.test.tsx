import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const useStreamMock = vi.fn(() => ({
  values: {},
  isLoading: false,
  isThreadLoading: false,
  interrupts: [],
  submit: vi.fn(),
}));

vi.mock('@langchain/langgraph-sdk/react', () => ({
  useStream: (args: unknown) => useStreamMock(args),
}));

vi.mock('../../services/langgraph/client', () => ({
  agentClient: {
    assistants: { getGraph: vi.fn().mockResolvedValue({ nodes: [] }) },
  },
  agentApiUrl: 'http://agent.example:9999',
}));

import { WorkflowDrawer } from './WorkflowDrawer';

describe('WorkflowDrawer agent URL', () => {
  it('passes the shared agentApiUrl (VITE_AGENT_URL aware) to useStream', () => {
    render(
      <WorkflowDrawer
        threadId="t1"
        projectId="p1"
        onClose={() => {}}
        onCollapse={() => {}}
      />,
    );

    expect(useStreamMock).toHaveBeenCalled();
    expect(useStreamMock.mock.calls[0][0].apiUrl).toBe('http://agent.example:9999');
  });
});
