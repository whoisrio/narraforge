import { describe, expect, it, vi } from 'vitest';
import type { Client } from '@langchain/langgraph-sdk';
import { hasPendingInterrupt, resolveWorkflowThread } from './threads';

const META = { project_id: 'p1', project_name: 'demo', kind: 'narration_workflow' };

function thread(id: string, status: string) {
  return { thread_id: id, status } as never;
}

function mockClient(overrides: {
  search?: unknown[];
  getState?: Record<string, { tasks: { interrupts: unknown[] }[] }>;
}) {
  const getState = vi.fn(
    async (id: string) =>
      overrides.getState?.[id] ?? { tasks: [{ interrupts: [{}] }] },
  );
  return {
    client: {
      threads: {
        search: vi.fn(async () => overrides.search ?? []),
        getState,
        delete: vi.fn(async () => ({})),
        create: vi.fn(async () => ({ thread_id: 'new-thread' })),
      },
    } as unknown as Client,
    getState,
  };
}

describe('hasPendingInterrupt', () => {
  it('tasks 中有 interrupt 负载时返回 true', async () => {
    const { client } = mockClient({
      getState: { t1: { tasks: [{ interrupts: [{ id: 'i1' }] }] } },
    });
    expect(await hasPendingInterrupt(client, 't1')).toBe(true);
  });

  it('tasks 无 interrupt 负载（僵尸线程）返回 false', async () => {
    const { client } = mockClient({
      getState: { t1: { tasks: [{ interrupts: [] }] } },
    });
    expect(await hasPendingInterrupt(client, 't1')).toBe(false);
  });
});

describe('resolveWorkflowThread', () => {
  it('busy 线程直接接管，不查 state', async () => {
    const { client, getState } = mockClient({ search: [thread('t-busy', 'busy')] });
    expect(await resolveWorkflowThread(client, META)).toBe('t-busy');
    expect(getState).not.toHaveBeenCalled();
  });

  it('interrupted 且有审批负载 → 接管', async () => {
    const { client } = mockClient({
      search: [thread('t-irq', 'interrupted')],
      getState: { 't-irq': { tasks: [{ interrupts: [{ id: 'i1' }] }] } },
    });
    expect(await resolveWorkflowThread(client, META)).toBe('t-irq');
  });

  it('interrupted 但无负载（僵尸）→ 自动删除并创建新线程', async () => {
    const { client } = mockClient({
      search: [thread('t-zombie', 'interrupted')],
      getState: { 't-zombie': { tasks: [{ interrupts: [] }] } },
    });
    expect(await resolveWorkflowThread(client, META)).toBe('new-thread');
    expect(client.threads.delete).toHaveBeenCalledWith('t-zombie');
    expect(client.threads.create).toHaveBeenCalledWith({ metadata: META });
  });

  it('僵尸线程清理后继续匹配到后面的可接管线程', async () => {
    const { client } = mockClient({
      search: [thread('t-zombie', 'interrupted'), thread('t-irq', 'interrupted')],
      getState: {
        't-zombie': { tasks: [{ interrupts: [] }] },
        't-irq': { tasks: [{ interrupts: [{ id: 'i1' }] }] },
      },
    });
    expect(await resolveWorkflowThread(client, META)).toBe('t-irq');
    expect(client.threads.delete).toHaveBeenCalledWith('t-zombie');
    expect(client.threads.create).not.toHaveBeenCalled();
  });

  it('无活跃线程 → 创建新线程', async () => {
    const { client } = mockClient({ search: [thread('t-old', 'idle')] });
    expect(await resolveWorkflowThread(client, META)).toBe('new-thread');
    expect(client.threads.delete).not.toHaveBeenCalled();
  });
});
